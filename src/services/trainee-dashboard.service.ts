import { prisma } from "../config/prisma";
import { announcementService } from "./announcement.service";
import { assignmentService } from "./assignment.service";
import { calendarService, type CalendarEventType } from "./calendar.service";
import { leaderboardService } from "./leaderboard.service";
import { progressService } from "./progress.service";
import { resolveDashboardRange } from "./trainer-dashboard.service";
import type { AuthUser } from "../types";

const ACTIONABLE_SUBMISSION = new Set(["NOT_STARTED", "IN_PROGRESS", "CHANGES_REQUESTED"]);
const DONE_LEARNING = new Set(["COMPLETED", "PASSED"]);

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

function continueHref(
  programId: string,
  nextActivity: { type: string; id: string } | null,
  batchId?: string | null,
): string {
  const batch = batchId ? `&batchId=${encodeURIComponent(batchId)}` : "";
  if (!nextActivity) {
    return `/trainee/learn?programId=${programId}${batch}`;
  }
  return `/trainee/learn?programId=${programId}${batch}&type=${nextActivity.type}&id=${nextActivity.id}`;
}

function eventHref(type: CalendarEventType, sourceId: string, programId: string): string {
  if (type === "ASSIGNMENT") {
    return `/trainee/assignments/${sourceId}`;
  }
  if (type === "EXAM") {
    return `/trainee/assessments/${sourceId}`;
  }
  if (type === "SESSION") {
    return "/trainee/calendar";
  }
  return `/trainee/learn?programId=${programId}`;
}

function remainingMinutesFromLearn(weeks: Array<{
  days: Array<{
    items: Array<{ status: string; durationMin?: number; durationSec?: number }>;
  }>;
}>): number | null {
  let minutes = 0;
  let hasDuration = false;
  for (const week of weeks) {
    for (const day of week.days) {
      for (const item of day.items) {
        if (DONE_LEARNING.has(item.status)) {
          continue;
        }
        if (item.durationMin && item.durationMin > 0) {
          minutes += item.durationMin;
          hasDuration = true;
        } else if (item.durationSec && item.durationSec > 0) {
          minutes += Math.ceil(item.durationSec / 60);
          hasDuration = true;
        }
      }
    }
  }
  return hasDuration ? minutes : null;
}

export const traineeDashboardService = {
  async getOverview(user: AuthUser, rangeInput?: unknown) {
    const { range, start, end } = resolveDashboardRange(rangeInput);
    const now = new Date();
    const enrollments = await progressService.listSummaries(user.id);
    const primary = enrollments[0] ?? null;

    const [learningResult, upcomingResult, assignmentsResult, announcementsResult, leaderboardResult] =
      await Promise.all([
        settled(primary ? loadLearning(user, primary.program.id, primary.batch?.id) : Promise.resolve(null)),
        settled(loadUpcoming(user, now, end)),
        settled(loadPendingAssignments(user)),
        settled(loadAnnouncements(user)),
        settled(primary ? loadTopStudent(user, primary.program.id) : Promise.resolve(null)),
      ]);

    const upcoming = upcomingResult.data ?? [];
    const pendingAssignments = assignmentsResult.data ?? [];
    const progressValues = enrollments.map((row) => row.progress.percent);
    const overallProgress =
      progressValues.length === 0
        ? 0
        : Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length);

    return {
      range,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      statistics: {
        enrolledPrograms: {
          total: enrollments.length,
          active: enrollments.filter((row) => row.course.outcome === "PENDING").length,
          completed: enrollments.filter((row) => row.course.outcome === "PASSED").length,
          failed: enrollments.filter((row) => row.course.outcome === "FAILED").length,
        },
        overallProgress: { percent: overallProgress },
        pendingAssignments: { total: pendingAssignments.length },
        upcomingAssessments: { total: upcoming.filter((item) => item.type === "EXAM").length },
      },
      currentLearning: learningResult.data,
      topStudent: leaderboardResult.data,
      upcoming,
      pendingAssignments,
      announcements: announcementsResult.data ?? [],
      otherPrograms: enrollments.slice(1).map((row) => ({
        id: row.id,
        title: row.program.title,
        percent: row.progress.percent,
        outcome: row.course.outcome,
        href: `/trainee/learn?programId=${row.program.id}${row.batch?.id ? `&batchId=${row.batch.id}` : ""}`,
      })),
      errors: {
        learning: learningResult.error,
        upcoming: upcomingResult.error,
        assignments: assignmentsResult.error,
        announcements: announcementsResult.error,
        topStudent: leaderboardResult.error,
      },
    };
  },

  async search(user: AuthUser, rawQuery: string) {
    const query = rawQuery.trim();
    if (query.length < 2) {
      return { programs: [], materials: [], assignments: [], assessments: [], announcements: [] };
    }

    const enrollments = await progressService.listSummaries(user.id);
    const programIds = enrollments.map((row) => row.program.id);
    const contains = { contains: query, mode: "insensitive" as const };

    const [assignments, quizzes, lessons, videos, resources, announcementPayload] = await Promise.all([
      programIds.length === 0
        ? []
        : prisma.assignment.findMany({
            where: { day: { week: { programId: { in: programIds } } }, title: contains, status: { not: "DRAFT" } },
            select: { id: true, title: true, day: { select: { week: { select: { program: { select: { title: true } } } } } } },
            take: 5,
          }),
      programIds.length === 0
        ? []
        : prisma.quiz.findMany({
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
            take: 5,
          }),
      programIds.length === 0
        ? []
        : prisma.lesson.findMany({
            where: { title: contains, day: { week: { programId: { in: programIds } } } },
            select: { id: true, title: true, day: { select: { week: { select: { programId: true, program: { select: { title: true } } } } } } },
            take: 5,
          }),
      programIds.length === 0
        ? []
        : prisma.video.findMany({
            where: { title: contains, day: { week: { programId: { in: programIds } } } },
            select: { id: true, title: true, day: { select: { week: { select: { programId: true, program: { select: { title: true } } } } } } },
            take: 5,
          }),
      programIds.length === 0
        ? []
        : prisma.resource.findMany({
            where: { title: contains, day: { week: { programId: { in: programIds } } } },
            select: { id: true, title: true, day: { select: { week: { select: { programId: true, program: { select: { title: true } } } } } } },
            take: 5,
          }),
      announcementService.listForUser(user),
    ]);

    const needle = query.toLowerCase();
    const announcements = announcementPayload.announcements
      .filter((item) => item.title.toLowerCase().includes(needle) || item.body.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.program?.title ?? item.audience.toLowerCase(),
        href: "/trainee/announcements",
      }));

    return {
      programs: enrollments
        .filter((row) => row.program.title.toLowerCase().includes(needle) || row.program.category.toLowerCase().includes(needle))
        .slice(0, 5)
        .map((row) => ({
          id: row.program.id,
          title: row.program.title,
          subtitle: row.program.category,
          href: `/trainee/program?programId=${row.program.id}`,
        })),
      materials: [
        ...lessons.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.day.week.program.title,
          href: `/trainee/learn?programId=${item.day.week.programId}&type=LESSON&id=${item.id}`,
        })),
        ...videos.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.day.week.program.title,
          href: `/trainee/learn?programId=${item.day.week.programId}&type=VIDEO&id=${item.id}`,
        })),
        ...resources.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.day.week.program.title,
          href: `/trainee/learn?programId=${item.day.week.programId}&type=RESOURCE&id=${item.id}`,
        })),
      ].slice(0, 5),
      assignments: assignments.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.day.week.program.title,
        href: `/trainee/assignments/${item.id}`,
      })),
      assessments: quizzes.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.kind.replaceAll("_", " ").toLowerCase(),
        href: `/trainee/assessments/${item.id}`,
      })),
      announcements,
    };
  },
};

async function loadLearning(user: AuthUser, programId: string, batchId?: string | null) {
  const [learn, progress] = await Promise.all([
    progressService.getLearnView(user, programId, batchId ?? undefined),
    progressService.getProgressView(user, programId, batchId ?? undefined),
  ]);

  const completedMilestones = progress.milestones.filter((item) => item.satisfied).slice(-4);
  const upcomingMilestone = progress.milestones.find((item) => !item.satisfied) ?? null;
  const batchQuery = batchId ? `&batchId=${encodeURIComponent(batchId)}` : "";

  return {
    program: {
      id: learn.program.id,
      title: learn.program.title,
      category: learn.program.category,
      durationWeeks: learn.program.durationWeeks,
    },
    enrollmentStatus: learn.enrollment.status,
    course: learn.course,
    percent: learn.progress.percent,
    currentWeek: learn.currentWeek,
    currentDay: learn.currentDay,
    nextActivity: learn.nextActivity,
    remainingMinutes: remainingMinutesFromLearn(learn.weeks),
    continueHref: continueHref(programId, learn.nextActivity, batchId),
    materialsHref: `/trainee/learn?programId=${programId}${batchQuery}`,
    quizzesHref: "/trainee/assessments",
    assignmentsHref: "/trainee/assignments",
    programHref: `/trainee/program?programId=${programId}${batchQuery}`,
    progressHref: `/trainee/progress?programId=${programId}${batchQuery}`,
    milestones: {
      completed: completedMilestones.map((item) => ({ id: item.id, title: item.title })),
      upcoming: upcomingMilestone ? { id: upcomingMilestone.id, title: upcomingMilestone.title } : null,
      current: progress.currentMilestone,
    },
  };
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

async function loadPendingAssignments(user: AuthUser) {
  const { assignments } = await assignmentService.listForTrainee(user);
  return assignments
    .filter((row) => ACTIONABLE_SUBMISSION.has(row.submission.status) && row.assignment.status !== "LOCKED")
    .slice(0, 8)
    .map((row) => ({
      id: row.assignment.id,
      title: row.assignment.title,
      programTitle: row.assignment.programTitle,
      dueDate: row.assignment.dueDate ? new Date(row.assignment.dueDate).toISOString() : null,
      status: row.submission.status,
      isLate: Boolean(row.assignment.pastDue && row.submission.status !== "SUBMITTED"),
      href: `/trainee/assignments/${row.assignment.id}`,
    }));
}

async function loadAnnouncements(user: AuthUser) {
  const { announcements } = await announcementService.listForUser(user);
  return announcements.slice(0, 6).map((item) => ({
    id: item.id,
    title: item.title,
    body: item.body,
    audience: item.audience,
    programTitle: item.program?.title ?? null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt),
    href: "/trainee/announcements",
  }));
}

async function loadTopStudent(user: AuthUser, programId: string) {
  const { boards } = await leaderboardService.forTrainee(user, programId);
  const board = boards[0];
  const top = board?.entries[0];
  if (!board || !top) {
    return null;
  }
  return {
    programTitle: board.program.title,
    trainee: top.trainee,
    rank: top.rank,
    score: top.score,
    progressPercent: top.progressPercent,
    isYou: board.you?.trainee.id === top.trainee.id,
    href: "/trainee/leaderboard",
  };
}
