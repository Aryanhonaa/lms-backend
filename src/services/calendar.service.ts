import { QuizKind } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programRepository } from "../repositories/program.repository";
import { enrollmentService } from "./enrollment.service";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { ACTIVE_STATUS_FILTER } from "../utils/enrollment-status";

export type CalendarEventType =
  | "SESSION"
  | "EXAM"
  | "ASSIGNMENT"
  | "DEADLINE"
  | "PROGRAM"
  | "HOLIDAY"
  | "ACTIVITY";

type CalendarEvent = {
  id: string;
  type: CalendarEventType;
  title: string;
  startsAt: string;
  endsAt: string | null;
  program: { id: string; title: string };
  sourceId: string;
  description?: string;
  batchIds?: string[];
  traineeIds?: string[];
  batch?: { id: string; name: string } | null;
  trainee?: { id: string; name: string } | null;
};

function event(
  type: CalendarEventType,
  sourceId: string,
  title: string,
  startsAt: Date | null,
  program: { id: string; title: string },
  endsAt: Date | null = null,
): CalendarEvent | null {
  if (!startsAt) {
    return null;
  }

  return {
    id: `${type.toLowerCase()}:${sourceId}`,
    type,
    title,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt ? endsAt.toISOString() : null,
    program: { id: program.id, title: program.title },
    sourceId,
  };
}

function examDate(input: {
  kind: QuizKind;
  weekStart: Date | null;
  weekEnd: Date | null;
  programEnd: Date | null;
  programStart: Date | null;
}): Date | null {
  if (input.kind === QuizKind.WEEKLY_EXAM || input.kind === QuizKind.WEEKLY_QUIZ) {
    return input.weekEnd ?? input.weekStart;
  }
  if (input.kind === QuizKind.FINAL_EXAM) {
    return input.programEnd ?? input.programStart;
  }
  return null;
}

async function eventsForPrograms(programIds: string[], traineeUserId?: string): Promise<CalendarEvent[]> {
  if (programIds.length === 0) {
    return [];
  }

  const programs = await prisma.program.findMany({
    where: { id: { in: programIds } },
    select: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      weeks: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          sortOrder: true,
          startDate: true,
          endDate: true,
          trainingSessions: {
            select: { id: true, title: true, startsAt: true, endsAt: true },
          },
          quizzes: { select: { id: true, title: true, kind: true } },
          days: {
            select: {
              assignments: { select: { id: true, title: true, dueDate: true, status: true } },
              quizzes: { select: { id: true, title: true, kind: true } },
            },
          },
        },
      },
      quizzes: { select: { id: true, title: true, kind: true } },
    },
  });

  const events: CalendarEvent[] = [];

  for (const program of programs) {
    const programRef = { id: program.id, title: program.title };
    const pushed = event("PROGRAM", `${program.id}:start`, `${program.title} starts`, program.startDate, programRef);
    if (pushed) {
      events.push(pushed);
    }
    const ended = event("PROGRAM", `${program.id}:end`, `${program.title} ends`, program.endDate, programRef);
    if (ended) {
      events.push(ended);
    }

    for (const week of program.weeks) {
      const weekStart = event("PROGRAM", week.id, `${week.title} opens`, week.startDate, programRef, week.endDate);
      if (weekStart) {
        events.push(weekStart);
      }

      for (const session of week.trainingSessions) {
        const row = event("SESSION", session.id, session.title, session.startsAt, programRef, session.endsAt);
        if (row) {
          events.push(row);
        }
      }

      for (const quiz of week.quizzes) {
        if (quiz.kind === QuizKind.PRACTICE_QUIZ) {
          continue;
        }
        const at = examDate({
          kind: quiz.kind,
          weekStart: week.startDate,
          weekEnd: week.endDate,
          programEnd: program.endDate,
          programStart: program.startDate,
        });
        const row = event("EXAM", quiz.id, quiz.title, at, programRef);
        if (row) {
          events.push(row);
        }
      }

      for (const day of week.days) {
        for (const assignment of day.assignments) {
          if (assignment.status === "DRAFT") {
            continue;
          }
          const row = event("ASSIGNMENT", assignment.id, assignment.title, assignment.dueDate, programRef);
          if (row) {
            events.push(row);
          }
        }
        for (const quiz of day.quizzes) {
          if (quiz.kind !== QuizKind.WEEKLY_EXAM && quiz.kind !== QuizKind.WEEKLY_QUIZ) {
            continue;
          }
          const at = examDate({
            kind: quiz.kind,
            weekStart: week.startDate,
            weekEnd: week.endDate,
            programEnd: program.endDate,
            programStart: program.startDate,
          });
          const row = event("EXAM", quiz.id, quiz.title, at, programRef);
          if (row) {
            events.push(row);
          }
        }
      }
    }

    for (const quiz of program.quizzes) {
      const at = examDate({
        kind: quiz.kind,
        weekStart: null,
        weekEnd: null,
        programEnd: program.endDate,
        programStart: program.startDate,
      });
      const row = event("EXAM", quiz.id, quiz.title, at, programRef);
      if (row) {
        events.push(row);
      }
    }
  }

  const batches = await prisma.programBatch.findMany({
    where: { programId: { in: programIds } },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      program: { select: { id: true, title: true } },
    },
  });
  for (const batch of batches) {
    const programRef = { id: batch.program.id, title: batch.program.title };
    const started = event("PROGRAM", `${batch.id}:start`, `${batch.name} starts`, batch.startDate, programRef);
    if (started) {
      events.push({ ...started, batchIds: [batch.id], batch: { id: batch.id, name: batch.name } });
    }
    const ended = event("DEADLINE", `${batch.id}:end`, `Complete ${batch.name}`, batch.endDate, programRef);
    if (ended) {
      events.push({ ...ended, batchIds: [batch.id], batch: { id: batch.id, name: batch.name } });
    }
  }

  if (traineeUserId) {
    const enrollments = await enrollmentRepository.findByUser(traineeUserId);
    const mine = enrollments.filter((row) => programIds.includes(row.programId));
    const requirements = await prisma.individualRequirement.findMany({
      where: { enrollmentId: { in: mine.map((row) => row.id) }, deadline: { not: null } },
      include: { enrollment: { include: { program: { select: { id: true, title: true } } } } },
    });
    for (const requirement of requirements) {
      const row = event(
        "DEADLINE",
        requirement.id,
        requirement.title,
        requirement.deadline,
        requirement.enrollment.program,
      );
      if (row) {
        events.push(row);
      }
    }
  }

  events.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  return events;
}

async function holidayEvents(): Promise<CalendarEvent[]> {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  return holidays.map((row) => ({
    id: `holiday:${row.id}`,
    type: "HOLIDAY",
    title: row.name,
    startsAt: row.date.toISOString(),
    endsAt: null,
    program: { id: "", title: "Public holiday" },
    sourceId: row.id,
  }));
}

function withHolidays(events: CalendarEvent[], holidays: CalendarEvent[]): CalendarEvent[] {
  return [...events, ...holidays].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

async function activityEventsForPrograms(
  programIds: string[],
  options: { traineeUserId?: string; batchIds?: string[] } = {},
): Promise<CalendarEvent[]> {
  if (programIds.length === 0) {
    return [];
  }

  const where: {
    programId: { in: string[] };
    batchId?: { in: string[] };
    OR?: Array<{ traineeUserId: string } | { traineeUserId: null }>;
  } = { programId: { in: programIds } };

  if (options.batchIds && options.batchIds.length > 0) {
    where.batchId = { in: options.batchIds };
  }
  if (options.traineeUserId) {
    where.OR = [{ traineeUserId: options.traineeUserId }, { traineeUserId: null }];
  }

  const rows = await prisma.calendarActivity.findMany({
    where,
    include: {
      program: { select: { id: true, title: true } },
      batch: { select: { id: true, name: true } },
      trainee: { select: { id: true, name: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  return rows.map((row) => ({
    id: `activity:${row.id}`,
    type: "ACTIVITY" as const,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    program: row.program,
    sourceId: row.id,
    description: row.description || undefined,
    batchIds: [row.batchId],
    traineeIds: row.traineeUserId ? [row.traineeUserId] : undefined,
    batch: row.batch,
    trainee: row.trainee,
  }));
}

type TrainerCalendarFilters = {
  courses: Array<{ id: string; title: string }>;
  batches: Array<{ id: string; programId: string; name: string }>;
  trainees: Array<{
    id: string;
    name: string;
    programId: string;
    batchId: string;
    batchName: string;
  }>;
};

const EMPTY_FILTERS: TrainerCalendarFilters = { courses: [], batches: [], trainees: [] };

async function filtersForPrograms(programIds: string[]): Promise<TrainerCalendarFilters> {
  if (programIds.length === 0) {
    return EMPTY_FILTERS;
  }

  const [courses, batches, enrollments] = await Promise.all([
    prisma.program.findMany({
      where: { id: { in: programIds } },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.programBatch.findMany({
      where: { programId: { in: programIds } },
      select: { id: true, programId: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.enrollment.findMany({
      where: {
        programId: { in: programIds },
        status: ACTIVE_STATUS_FILTER,
      },
      select: {
        programId: true,
        batchId: true,
        user: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const trainees = enrollments
    .filter((row) => Boolean(row.batch))
    .map((row) => ({
      id: row.user.id,
      name: row.user.name,
      programId: row.programId,
      batchId: row.batchId,
      batchName: row.batch!.name,
    }));

  return { courses, batches, trainees };
}

export const calendarService = {
  async listForUser(user: AuthUser) {
    if (user.role === "TRAINEE") {
      await enrollmentService.ensureVisibleEnrollments(user.id);
      const enrollments = await enrollmentRepository.findByUser(user.id);
      const programIds = enrollments
        .filter((row) => row.program.status === "APPROVED" || row.program.status === "PUBLISHED")
        .map((row) => row.programId);
      const enrollmentsForScope = enrollments.filter(
        (row) => row.program.status === "APPROVED" || row.program.status === "PUBLISHED",
      );
      const [events, holidays, activities] = await Promise.all([
        eventsForPrograms(programIds, user.id),
        holidayEvents(),
        activityEventsForPrograms(programIds, {
          traineeUserId: user.id,
          batchIds: enrollmentsForScope.map((row) => row.batchId).filter(Boolean),
        }),
      ]);
      return { events: withHolidays([...events, ...activities], holidays) };
    }

    if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
      const programs = await programRepository.findCatalog();
      const programIds = programs.map((row) => row.id);
      const [events, holidays, activities] = await Promise.all([
        eventsForPrograms(programIds),
        holidayEvents(),
        activityEventsForPrograms(programIds),
      ]);
      return { events: withHolidays([...events, ...activities], holidays) };
    }

    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }

    const programIds = await programService.listProgramIdsForTrainer(user.id);
    const [events, holidays, filters, activities] = await Promise.all([
      eventsForPrograms(programIds),
      holidayEvents(),
      filtersForPrograms(programIds),
      activityEventsForPrograms(programIds),
    ]);
    return { events: withHolidays([...events, ...activities], holidays), filters };
  },
};
