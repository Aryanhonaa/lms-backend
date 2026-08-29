import {
  AssignmentSubmissionStatus,
  EnrollmentStatus,
  InterventionStatus,
  ProgramStatus,
} from "../generated/prisma";
import { prisma } from "../config/prisma";
import { calendarService, type CalendarEventType } from "./calendar.service";
import { programService } from "./program.service";
import type { AuthUser } from "../types";

export type DashboardRange = "week" | "month" | "quarter";

const ACTIVE_PROGRAM: ProgramStatus[] = [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED];
const REVIEWABLE_SUBMISSION: AssignmentSubmissionStatus[] = [
  AssignmentSubmissionStatus.SUBMITTED,
  AssignmentSubmissionStatus.GRADED,
  AssignmentSubmissionStatus.CHANGES_REQUESTED,
  AssignmentSubmissionStatus.COMPLETED,
];

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function resolveDashboardRange(value: unknown, now = new Date()): {
  range: DashboardRange;
  start: Date;
  end: Date;
} {
  const range: DashboardRange = value === "month" || value === "quarter" ? value : "week";
  const today = startOfUtcDay(now);

  if (range === "month") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    return { range, start, end };
  }

  if (range === "quarter") {
    const quarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
    const start = new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth + 3, 1));
    return { range, start, end };
  }

  const weekday = today.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  const start = addUtcDays(today, -daysFromMonday);
  return { range, start, end: addUtcDays(start, 7) };
}

function sectionError(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load this section.";
}

async function settled<T>(task: Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await task, error: null };
  } catch (error) {
    return { data: null, error: sectionError(error) };
  }
}

function eventHref(type: CalendarEventType, sourceId: string, programId: string): string {
  if (type === "ASSIGNMENT") {
    return `/trainer/assignments/${sourceId}`;
  }
  if (type === "EXAM") {
    return `/trainer/assessments/${sourceId}`;
  }
  if (type === "SESSION" || type === "DEADLINE" || type === "MILESTONE" || type === "PROGRAM") {
    return type === "SESSION" ? "/trainer/calendar" : `/trainer/programs/${programId}`;
  }
  return "/trainer/calendar";
}

export const trainerDashboardService = {
  async getOverview(user: AuthUser, rangeInput?: unknown) {
    const { range, start, end } = resolveDashboardRange(rangeInput);
    const programIds = await programService.listProgramIdsForTrainer(user.id);
    const now = new Date();

    const [statisticsResult, programsResult, upcomingResult, submissionsResult, attentionResult] = await Promise.all([
      settled(loadStatistics(programIds)),
      settled(loadPrograms(programIds)),
      settled(loadUpcoming(user, now, end)),
      settled(loadRecentSubmissions(programIds, start)),
      settled(loadAttention(programIds)),
    ]);

    const upcoming = upcomingResult.data ?? [];
    const statistics = statisticsResult.data ?? {
      programs: { total: 0, active: 0 },
      trainees: { total: 0 },
      pendingReviews: { total: 0 },
      upcomingAssessments: { total: upcoming.filter((item) => item.type === "EXAM").length },
      pendingSubmissions: { total: 0 },
    };

    if (upcomingResult.data) {
      statistics.upcomingAssessments = {
        total: upcoming.filter((item) => item.type === "EXAM").length,
      };
    }

    return {
      range,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      statistics,
      programs: programsResult.data ?? [],
      upcoming,
      recentSubmissions: submissionsResult.data ?? [],
      attention: attentionResult.data ?? [],
      errors: {
        statistics: statisticsResult.error,
        programs: programsResult.error,
        upcoming: upcomingResult.error,
        submissions: submissionsResult.error,
        attention: attentionResult.error,
      },
    };
  },

  async search(user: AuthUser, rawQuery: string) {
    const query = rawQuery.trim();
    if (query.length < 2) {
      return { programs: [], trainees: [], assignments: [], assessments: [] };
    }

    const programIds = await programService.listProgramIdsForTrainer(user.id);
    if (programIds.length === 0) {
      return { programs: [], trainees: [], assignments: [], assessments: [] };
    }

    const contains = { contains: query, mode: "insensitive" as const };

    const [programs, enrollments, assignments, quizzes] = await Promise.all([
      prisma.program.findMany({
        where: { id: { in: programIds }, OR: [{ title: contains }, { category: contains }] },
        select: { id: true, title: true, category: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.enrollment.findMany({
        where: {
          programId: { in: programIds },
          status: { not: EnrollmentStatus.WITHDRAWN },
          user: { OR: [{ name: contains }, { email: contains }] },
        },
        select: {
          programId: true,
          program: { select: { title: true } },
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.assignment.findMany({
        where: { day: { week: { programId: { in: programIds } } }, title: contains },
        select: { id: true, title: true, day: { select: { week: { select: { program: { select: { title: true } } } } } } },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.quiz.findMany({
        where: {
          title: contains,
          OR: [
            { programId: { in: programIds } },
            { week: { programId: { in: programIds } } },
            { day: { week: { programId: { in: programIds } } } },
            { milestone: { programId: { in: programIds } } },
          ],
        },
        select: { id: true, title: true, kind: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
    ]);

    const trainees = [];
    const seenTrainees = new Set<string>();
    for (const row of enrollments) {
      if (seenTrainees.has(row.user.id)) {
        continue;
      }
      seenTrainees.add(row.user.id);
      trainees.push({
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        programTitle: row.program.title,
        href: `/trainer/programs/${row.programId}/trainees`,
      });
      if (trainees.length >= 5) {
        break;
      }
    }

    return {
      programs: programs.map((program) => ({
        id: program.id,
        title: program.title,
        subtitle: program.category,
        href: `/trainer/programs/${program.id}`,
      })),
      trainees,
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        subtitle: assignment.day.week.program.title,
        href: `/trainer/assignments/${assignment.id}`,
      })),
      assessments: quizzes.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        subtitle: quiz.kind.replaceAll("_", " ").toLowerCase(),
        href: `/trainer/assessments/${quiz.id}`,
      })),
    };
  },
};

async function loadStatistics(programIds: string[]) {
  if (programIds.length === 0) {
    return {
      programs: { total: 0, active: 0 },
      trainees: { total: 0 },
      pendingReviews: { total: 0 },
      upcomingAssessments: { total: 0 },
      pendingSubmissions: { total: 0 },
    };
  }

  const [totalPrograms, activePrograms, traineeRows, pendingReviews, pendingSubmissions] = await Promise.all([
    prisma.program.count({ where: { id: { in: programIds } } }),
    prisma.program.count({ where: { id: { in: programIds }, status: { in: ACTIVE_PROGRAM } } }),
    prisma.enrollment.findMany({
      where: { programId: { in: programIds }, status: { not: EnrollmentStatus.WITHDRAWN } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.interventionFlag.count({
      where: { programId: { in: programIds }, status: InterventionStatus.OPEN },
    }),
    prisma.assignmentSubmission.count({
      where: {
        status: AssignmentSubmissionStatus.SUBMITTED,
        assignment: { day: { week: { programId: { in: programIds } } } },
      },
    }),
  ]);

  return {
    programs: { total: totalPrograms, active: activePrograms },
    trainees: { total: traineeRows.length },
    pendingReviews: { total: pendingReviews },
    upcomingAssessments: { total: 0 },
    pendingSubmissions: { total: pendingSubmissions },
  };
}

async function loadPrograms(programIds: string[]) {
  if (programIds.length === 0) {
    return [];
  }

  const programs = await prisma.program.findMany({
    where: { id: { in: programIds } },
    select: {
      id: true,
      title: true,
      category: true,
      status: true,
      durationWeeks: true,
      startDate: true,
      endDate: true,
      enrollments: {
        where: { status: { not: EnrollmentStatus.WITHDRAWN } },
        select: { overallProgress: true, courseOutcome: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });

  return programs.map((program) => {
    const traineeCount = program.enrollments.length;
    const progress =
      traineeCount === 0
        ? null
        : Math.round(
            program.enrollments.reduce((sum, row) => sum + toNumber(row.overallProgress), 0) / traineeCount,
          );
    const outcomeCounts = {
      inProgress: program.enrollments.filter((row) => row.courseOutcome === "PENDING").length,
      completed: program.enrollments.filter((row) => row.courseOutcome === "PASSED").length,
      failed: program.enrollments.filter((row) => row.courseOutcome === "FAILED").length,
    };
    return {
      id: program.id,
      title: program.title,
      category: program.category,
      status: program.status,
      durationWeeks: program.durationWeeks,
      traineeCount,
      progress,
      outcomeCounts,
      href: `/trainer/programs/${program.id}`,
    };
  });
}

async function loadUpcoming(user: AuthUser, now: Date, rangeEnd: Date) {
  const { events } = await calendarService.listForUser(user);
  return events
    .filter((item) => {
      const at = new Date(item.startsAt).getTime();
      return at >= now.getTime() && at < rangeEnd.getTime();
    })
    .slice(0, 8)
    .map((item) => ({
      ...item,
      href: eventHref(item.type, item.sourceId, item.program.id),
    }));
}

async function loadRecentSubmissions(programIds: string[], rangeStart: Date) {
  if (programIds.length === 0) {
    return [];
  }

  const rows = await prisma.assignmentSubmission.findMany({
    where: {
      status: { in: REVIEWABLE_SUBMISSION },
      submittedAt: { not: null, gte: rangeStart },
      assignment: { day: { week: { programId: { in: programIds } } } },
    },
    select: {
      id: true,
      status: true,
      isLate: true,
      submittedAt: true,
      assignment: {
        select: {
          id: true,
          title: true,
          day: { select: { week: { select: { program: { select: { id: true, title: true } } } } } },
        },
      },
      enrollment: { select: { user: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { submittedAt: "desc" },
    take: 8,
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    isLate: row.isLate,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    assignment: { id: row.assignment.id, title: row.assignment.title },
    program: {
      id: row.assignment.day.week.program.id,
      title: row.assignment.day.week.program.title,
    },
    trainee: row.enrollment.user,
    href: `/trainer/assignments/${row.assignment.id}`,
  }));
}

async function loadAttention(programIds: string[]) {
  if (programIds.length === 0) {
    return [];
  }

  const flags = await prisma.interventionFlag.findMany({
    where: { programId: { in: programIds }, status: InterventionStatus.OPEN },
    select: {
      id: true,
      trigger: true,
      createdAt: true,
      enrollment: { select: { user: { select: { id: true, name: true, email: true } } } },
      program: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return flags.map((flag) => ({
    id: flag.id,
    trigger: flag.trigger,
    createdAt: flag.createdAt.toISOString(),
    trainee: flag.enrollment.user,
    program: flag.program,
    href: "/trainer/interventions",
  }));
}
