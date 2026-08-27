import { QuizKind } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programRepository } from "../repositories/program.repository";
import { enrollmentService } from "./enrollment.service";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";

export type CalendarEventType = "SESSION" | "EXAM" | "ASSIGNMENT" | "MILESTONE" | "DEADLINE" | "PROGRAM";

type CalendarEvent = {
  id: string;
  type: CalendarEventType;
  title: string;
  startsAt: string;
  endsAt: string | null;
  program: { id: string; title: string };
  sourceId: string;
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
            milestoneWeekEnd: null,
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
        const examEvent = event("EXAM", milestone.exam.id, milestone.exam.title, examAt, programRef);
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
      const row = event("EXAM", quiz.id, quiz.title, at, programRef);
      if (row) {
        events.push(row);
      }
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

export const calendarService = {
  async listForUser(user: AuthUser) {
    if (user.role === "TRAINEE") {
      await enrollmentService.ensureVisibleEnrollments(user.id);
      const enrollments = await enrollmentRepository.findByUser(user.id);
      const programIds = enrollments
        .filter((row) => row.program.status === "APPROVED" || row.program.status === "PUBLISHED")
        .map((row) => row.programId);
      return { events: await eventsForPrograms(programIds, user.id) };
    }

    if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
      const programs = await programRepository.findCatalog();
      return { events: await eventsForPrograms(programs.map((row) => row.id)) };
    }

    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }

    const programIds = await programService.listProgramIdsForTrainer(user.id);
    return { events: await eventsForPrograms(programIds) };
  },
};
