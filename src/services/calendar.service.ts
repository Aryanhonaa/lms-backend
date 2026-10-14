import { AnnouncementAudience, QuizKind } from "../generated/prisma";
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
  | "QUIZ"
  | "ASSIGNMENT"
  | "TASK"
  | "NOTIFICATION"
  | "MILESTONE"
  | "DEADLINE"
  | "PROGRAM"
  | "HOLIDAY";

export type CalendarEvent = {
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
  details: Pick<CalendarEvent, "description" | "batchIds" | "traineeIds" | "batch" | "trainee"> = {},
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
    ...details,
  };
}

function examDate(input: {
  kind: QuizKind;
  weekStart: Date | null;
  weekEnd: Date | null;
  milestoneWeekEnd: Date | null;
  programEnd: Date | null;
  programStart: Date | null;
}): Date | null {
  if (input.kind === QuizKind.WEEKLY_EXAM || input.kind === QuizKind.WEEKLY_QUIZ) {
    return input.weekEnd ?? input.weekStart;
  }
  if (input.kind === QuizKind.MILESTONE_EXAM) {
    return input.milestoneWeekEnd ?? input.weekEnd ?? input.weekStart;
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
      milestones: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, afterWeekIndex: true, exam: { select: { id: true, title: true, kind: true } } },
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
          milestoneWeekEnd: null,
          programEnd: program.endDate,
          programStart: program.startDate,
        });
        const row = event(quiz.kind === QuizKind.WEEKLY_QUIZ ? "QUIZ" : "EXAM", quiz.id, quiz.title, at, programRef);
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
            milestoneWeekEnd: null,
            programEnd: program.endDate,
            programStart: program.startDate,
          });
          const row = event(quiz.kind === QuizKind.WEEKLY_QUIZ ? "QUIZ" : "EXAM", quiz.id, quiz.title, at, programRef);
          if (row) {
            events.push(row);
          }
        }
      }
    }

    for (const milestone of program.milestones) {
      const week = program.weeks.find((item) => item.sortOrder === milestone.afterWeekIndex) ?? program.weeks[milestone.afterWeekIndex];
      const at = week?.endDate ?? week?.startDate ?? program.endDate ?? program.startDate;
      const row = event("MILESTONE", milestone.id, milestone.title, at ?? null, programRef);
      if (row) {
        events.push(row);
      }
      if (milestone.exam) {
        const examAt = examDate({
          kind: milestone.exam.kind,
          weekStart: week?.startDate ?? null,
          weekEnd: week?.endDate ?? null,
          milestoneWeekEnd: week?.endDate ?? null,
          programEnd: program.endDate,
          programStart: program.startDate,
        });
        const examEvent = event(
          milestone.exam.kind === QuizKind.WEEKLY_QUIZ ? "QUIZ" : "EXAM",
          milestone.exam.id,
          milestone.exam.title,
          examAt,
          programRef,
        );
        if (examEvent) {
          events.push(examEvent);
        }
      }
    }

    for (const quiz of program.quizzes) {
      const at = examDate({
        kind: quiz.kind,
        weekStart: null,
        weekEnd: null,
        milestoneWeekEnd: null,
        programEnd: program.endDate,
        programStart: program.startDate,
      });
      const row = event(quiz.kind === QuizKind.WEEKLY_QUIZ ? "QUIZ" : "EXAM", quiz.id, quiz.title, at, programRef);
      if (row) {
        events.push(row);
      }
    }
  }

  if (traineeUserId) {
    const enrollments = await enrollmentRepository.findByUser(traineeUserId);
    const mine = enrollments.filter((row) => programIds.includes(row.programId));
    const [requirements, announcements] = await Promise.all([
      mine.length
        ? prisma.individualRequirement.findMany({
            where: { enrollmentId: { in: mine.map((row) => row.id) }, deadline: { not: null } },
            include: {
              enrollment: {
                include: {
                  program: { select: { id: true, title: true } },
                  batch: { select: { id: true, name: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      prisma.announcement.findMany({
        where: {
          OR: [
            { audience: { in: [AnnouncementAudience.EVERYONE, AnnouncementAudience.TRAINEES] } },
            ...(programIds.length ? [{ audience: AnnouncementAudience.PROGRAM, programId: { in: programIds } }] : []),
            { audience: AnnouncementAudience.TRAINEES_SELECTED, recipients: { some: { userId: traineeUserId } } },
          ],
        },
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          program: { select: { id: true, title: true } },
          batch: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    for (const requirement of requirements) {
      const row = event(
        "TASK",
        requirement.id,
        requirement.title,
        requirement.deadline,
        requirement.enrollment.program,
        null,
        {
          description: requirement.description || requirement.trainerMessage,
          batchIds: [requirement.enrollment.batchId],
          batch: requirement.enrollment.batch,
        },
      );
      if (row) {
        events.push(row);
      }
    }
    for (const announcement of announcements) {
      const row = event(
        "NOTIFICATION",
        announcement.id,
        announcement.title,
        announcement.createdAt,
        announcement.program ?? { id: "", title: announcement.batch?.name ?? "General" },
        null,
        {
          description: announcement.body,
          ...(announcement.batch ? { batchIds: [announcement.batch.id], batch: announcement.batch } : {}),
        },
      );
      if (row) {
        events.push(row);
      }
    }
  }

  events.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  return events;
}

async function trainerCalendar(userId: string) {
  const programIds = await programService.listProgramIdsForTrainer(userId);
  const [baseEvents, holidays, courses, batches, enrollments, requirements, announcements] = await Promise.all([
    eventsForPrograms(programIds),
    holidayEvents(),
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
      where: { programId: { in: programIds }, status: ACTIVE_STATUS_FILTER },
      select: {
        userId: true,
        programId: true,
        user: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true } },
      },
      orderBy: [{ user: { name: "asc" } }],
    }),
    programIds.length
      ? prisma.individualRequirement.findMany({
          where: {
            deadline: { not: null },
            enrollment: { programId: { in: programIds }, status: ACTIVE_STATUS_FILTER },
          },
          select: {
            id: true,
            title: true,
            deadline: true,
            enrollment: {
              select: {
                program: { select: { id: true, title: true } },
                batch: { select: { id: true, name: true } },
                user: { select: { id: true, name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.announcement.findMany({
      where: {
        OR: [
          { audience: { in: [AnnouncementAudience.EVERYONE, AnnouncementAudience.TRAINERS] } },
          ...(programIds.length ? [{ programId: { in: programIds } }] : []),
        ],
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        program: { select: { id: true, title: true } },
        batch: { select: { id: true, name: true } },
        recipients: { select: { userId: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const batchesByProgram = new Map<string, typeof batches>();
  for (const batch of batches) {
    const list = batchesByProgram.get(batch.programId) ?? [];
    list.push(batch);
    batchesByProgram.set(batch.programId, list);
  }
  const enrollmentsByProgram = new Map<string, typeof enrollments>();
  for (const enrollment of enrollments) {
    const list = enrollmentsByProgram.get(enrollment.programId) ?? [];
    list.push(enrollment);
    enrollmentsByProgram.set(enrollment.programId, list);
  }

  const events: CalendarEvent[] = baseEvents.map((row) => {
    if (!row.program.id) {
      return row;
    }
    const courseBatches = batchesByProgram.get(row.program.id) ?? [];
    const courseEnrollments = enrollmentsByProgram.get(row.program.id) ?? [];
    return {
      ...row,
      batchIds: courseBatches.map((batch) => batch.id),
      traineeIds: courseEnrollments.map((enrollment) => enrollment.userId),
    };
  });

  for (const requirement of requirements) {
    const { enrollment } = requirement;
    const row = event("TASK", requirement.id, requirement.title, requirement.deadline, enrollment.program, null, {
      batchIds: [enrollment.batch.id],
      traineeIds: [enrollment.user.id],
      batch: enrollment.batch,
      trainee: enrollment.user,
    });
    if (row) {
      events.push(row);
    }
  }

  for (const announcement of announcements) {
    const program = announcement.program ?? { id: "", title: "General" };
    const relatedEnrollments = announcement.program
      ? enrollmentsByProgram.get(announcement.program.id) ?? []
      : [];
    const row = event("NOTIFICATION", announcement.id, announcement.title, announcement.createdAt, program, null, {
      ...(announcement.batch ? { batchIds: [announcement.batch.id], batch: announcement.batch } : {}),
      ...(announcement.program && !announcement.batch
        ? { batchIds: (batchesByProgram.get(announcement.program.id) ?? []).map((batch) => batch.id) }
        : {}),
      traineeIds: announcement.recipients.length
        ? announcement.recipients.map((recipient) => recipient.userId)
        : relatedEnrollments.map((enrollment) => enrollment.userId),
    });
    if (row) {
      events.push(row);
    }
  }

  return {
    events: withHolidays(events, holidays),
    filters: {
      courses,
      batches,
      trainees: enrollments.map((enrollment) => ({
        id: enrollment.user.id,
        name: enrollment.user.name,
        programId: enrollment.programId,
        batchId: enrollment.batch.id,
        batchName: enrollment.batch.name,
      })),
    },
  };
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

async function programEventsForUser(user: AuthUser): Promise<CalendarEvent[]> {
  if (user.role === "TRAINEE") {
    await enrollmentService.ensureVisibleEnrollments(user.id);
    const enrollments = await enrollmentRepository.findByUser(user.id);
    const programIds = enrollments
      .filter((row) => row.program.status === "APPROVED" || row.program.status === "PUBLISHED")
      .map((row) => row.programId);
    return eventsForPrograms(programIds, user.id);
  }

  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
    const programs = await programRepository.findCatalog();
    return eventsForPrograms(programs.map((row) => row.id));
  }

  if (user.role !== "TRAINER") {
    throw ApiError.forbidden();
  }

  const programIds = await programService.listProgramIdsForTrainer(user.id);
  return eventsForPrograms(programIds);
}

export const calendarService = {
  async listForUser(user: AuthUser) {
    if (user.role === "TRAINER") {
      return trainerCalendar(user.id);
    }
    const [events, holidays] = await Promise.all([programEventsForUser(user), holidayEvents()]);
    return { events: withHolidays(events, holidays) };
  },
};
