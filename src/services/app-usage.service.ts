import { EnrollmentStatus, Prisma, ProgramStatus, Role } from "../generated/prisma";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { appUsageRepository } from "../repositories/app-usage.repository";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isUuid } from "../validators/common";
import { isProgramReviewer } from "../utils/roles";
import {
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  addCivilDays,
  daysInMonth,
  mondayOnOrBefore,
  parseIsoDate,
  startOfZonedDay,
  todayInZone,
} from "../utils/timezone";
import type { UsageHeartbeatInput, UsagePeriod } from "../validators/app-usage.validators";

type CivilDate = { year: number; month: number; day: number };

export type AppUsageBucket = {
  key: string;
  label: string;
  start: string;
  end: string;
};

export type AppUsageTraineeRow = {
  id: string;
  name: string;
  seconds: number;
  buckets: Array<{ key: string; seconds: number }>;
};

export type AppUsageAnalytics = {
  period: UsagePeriod;
  timezone: string;
  mode: "comparison" | "individual";
  range: { start: string; end: string; label: string };
  summary: {
    totalSeconds: number;
    averageSeconds: number;
    activeTrainees: number;
    mostActive: { id: string; name: string; seconds: number } | null;
  };
  buckets: AppUsageBucket[];
  trainees: AppUsageTraineeRow[];
  truncated: boolean;
  filters: {
    programs: Array<{ id: string; title: string }>;
    batches: Array<{ id: string; name: string; programId: string }>;
    trainees: Array<{ id: string; name: string }>;
  };
};

function parseIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? item.split(",") : [])).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function durationSeconds(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.min(Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000), Math.floor(env.usageMaxSessionMs / 1000)));
}

function clipSeconds(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): number {
  const from = Math.max(start.getTime(), rangeStart.getTime());
  const to = Math.min(end.getTime(), rangeEnd.getTime());
  if (to <= from) {
    return 0;
  }
  return Math.floor((to - from) / 1000);
}

function effectiveEnd(session: { endedAt: Date | null; lastHeartbeatAt: Date; startedAt: Date }, now: Date): Date {
  const last = session.endedAt ?? session.lastHeartbeatAt;
  if (session.endedAt) {
    return last.getTime() < session.startedAt.getTime() ? session.startedAt : last;
  }
  const stale = now.getTime() - session.lastHeartbeatAt.getTime() > env.usageInactivityThresholdMs;
  const end = stale ? session.lastHeartbeatAt : now;
  return end.getTime() < session.startedAt.getTime() ? session.startedAt : end;
}

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dayLabel(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shortDayLabel(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function resolvePeriodRange(period: UsagePeriod, date: CivilDate, timeZone: string) {
  if (period === "daily") {
    const start = startOfZonedDay(date.year, date.month, date.day, timeZone);
    const next = addCivilDays(date.year, date.month, date.day, 1);
    const end = startOfZonedDay(next.year, next.month, next.day, timeZone);
    const buckets: AppUsageBucket[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const hourStart = new Date(start.getTime() + hour * 60 * 60 * 1000);
      const hourEnd = new Date(start.getTime() + (hour + 1) * 60 * 60 * 1000);
      const label = `${String(hour).padStart(2, "0")}:00`;
      buckets.push({
        key: `h-${hour}`,
        label,
        start: hourStart.toISOString(),
        end: hourEnd.toISOString(),
      });
    }
    return {
      start,
      end,
      label: dayLabel(date.year, date.month, date.day),
      buckets,
    };
  }

  if (period === "weekly") {
    const monday = mondayOnOrBefore(date.year, date.month, date.day, timeZone);
    const start = startOfZonedDay(monday.year, monday.month, monday.day, timeZone);
    const sunday = addCivilDays(monday.year, monday.month, monday.day, 6);
    const nextMonday = addCivilDays(monday.year, monday.month, monday.day, 7);
    const end = startOfZonedDay(nextMonday.year, nextMonday.month, nextMonday.day, timeZone);
    const buckets: AppUsageBucket[] = WEEKDAY_LABELS.map((label, index) => {
      const civil = addCivilDays(monday.year, monday.month, monday.day, index);
      const bucketStart = startOfZonedDay(civil.year, civil.month, civil.day, timeZone);
      const next = addCivilDays(civil.year, civil.month, civil.day, 1);
      return {
        key: WEEKDAY_SHORT_LABELS[index],
        label,
        start: bucketStart.toISOString(),
        end: startOfZonedDay(next.year, next.month, next.day, timeZone).toISOString(),
      };
    });
    return {
      start,
      end,
      label: `${shortDayLabel(monday.year, monday.month, monday.day)} – ${shortDayLabel(sunday.year, sunday.month, sunday.day)}`,
      buckets,
    };
  }

  const start = startOfZonedDay(date.year, date.month, 1, timeZone);
  const nextMonth = date.month === 12 ? { year: date.year + 1, month: 1 } : { year: date.year, month: date.month + 1 };
  const end = startOfZonedDay(nextMonth.year, nextMonth.month, 1, timeZone);
  const lastDay = daysInMonth(date.year, date.month);
  const buckets: AppUsageBucket[] = [];
  for (let week = 0; week < 5; week += 1) {
    const fromDay = week * 7 + 1;
    if (fromDay > lastDay) {
      break;
    }
    const toDay = Math.min(fromDay + 6, lastDay);
    const from = startOfZonedDay(date.year, date.month, fromDay, timeZone);
    const toCivil = toDay === lastDay ? { year: nextMonth.year, month: nextMonth.month, day: 1 } : addCivilDays(date.year, date.month, toDay, 1);
    const to = startOfZonedDay(toCivil.year, toCivil.month, toCivil.day, timeZone);
    buckets.push({
      key: `w-${week + 1}`,
      label: `Week ${week + 1}`,
      start: from.toISOString(),
      end: to.toISOString(),
    });
  }
  return {
    start,
    end,
    label: monthLabel(date.year, date.month),
    buckets,
  };
}

async function resolveContext(userId: string, input: UsageHeartbeatInput) {
  if (!input.programId && !input.batchId) {
    return { programId: null as string | null, batchId: null as string | null };
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      userId,
      status: { not: EnrollmentStatus.WITHDRAWN },
      ...(input.batchId ? { batchId: input.batchId } : {}),
      ...(input.programId ? { programId: input.programId } : {}),
    },
    select: { programId: true, batchId: true },
  });

  if (!enrollment) {
    return { programId: null, batchId: null };
  }

  return { programId: enrollment.programId, batchId: enrollment.batchId };
}

async function listScopedTrainees(viewer: AuthUser, programId?: string, batchId?: string) {
  if (viewer.role === Role.TRAINEE) {
    const self = await prisma.user.findUnique({
      where: { id: viewer.id },
      select: { id: true, name: true },
    });
    return self ? [self] : [];
  }

  if (viewer.role === Role.TRAINER) {
    const programIds = await programService.listProgramIdsForTrainer(viewer.id);
    if (programIds.length === 0) {
      if (programId || batchId) {
        throw ApiError.forbidden();
      }
      return [];
    }
    if (programId && !programIds.includes(programId)) {
      throw ApiError.forbidden();
    }
    if (batchId) {
      const batch = await prisma.programBatch.findUnique({ where: { id: batchId }, select: { id: true, programId: true } });
      if (!batch || !programIds.includes(batch.programId) || (programId && batch.programId !== programId)) {
        throw ApiError.forbidden();
      }
    }
    const enrollments = await prisma.enrollment.findMany({
      where: {
        status: { not: EnrollmentStatus.WITHDRAWN },
        programId: programId ?? { in: programIds },
        ...(batchId ? { batchId } : {}),
      },
      select: { user: { select: { id: true, name: true } } },
      distinct: ["userId"],
    });
    return enrollments.map((row) => row.user).sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!isProgramReviewer(viewer.role)) {
    throw ApiError.forbidden();
  }

  if (batchId) {
    const batch = await prisma.programBatch.findUnique({ where: { id: batchId }, select: { id: true, programId: true } });
    if (!batch || (programId && batch.programId !== programId)) {
      throw ApiError.notFound("Batch not found");
    }
  }

  if (programId || batchId) {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        status: { not: EnrollmentStatus.WITHDRAWN },
        ...(programId ? { programId } : {}),
        ...(batchId ? { batchId } : {}),
      },
      select: { user: { select: { id: true, name: true } } },
      distinct: ["userId"],
    });
    return enrollments.map((row) => row.user).sort((a, b) => a.name.localeCompare(b.name));
  }

  return prisma.user.findMany({
    where: { role: Role.TRAINEE, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function listFilterOptions(viewer: AuthUser) {
  if (viewer.role === Role.TRAINEE) {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: viewer.id, status: { not: EnrollmentStatus.WITHDRAWN } },
      select: {
        program: { select: { id: true, title: true } },
        batch: { select: { id: true, name: true, programId: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const programs = new Map<string, string>();
    const batches: Array<{ id: string; name: string; programId: string }> = [];
    for (const row of enrollments) {
      programs.set(row.program.id, row.program.title);
      batches.push(row.batch);
    }
    return {
      programs: [...programs.entries()].map(([id, title]) => ({ id, title })),
      batches,
      trainees: [{ id: viewer.id, name: viewer.name }],
    };
  }

  const programWhere =
    viewer.role === Role.TRAINER
      ? { id: { in: await programService.listProgramIdsForTrainer(viewer.id) } }
      : { status: { not: ProgramStatus.DRAFT } };

  const programs = await prisma.program.findMany({
    where: programWhere,
    select: {
      id: true,
      title: true,
      batches: { select: { id: true, name: true, programId: true }, orderBy: { createdAt: "desc" } },
    },
    orderBy: { title: "asc" },
  });

  return {
    programs: programs.map((row) => ({ id: row.id, title: row.title })),
    batches: programs.flatMap((row) => row.batches),
    trainees: await listScopedTrainees(viewer),
  };
}

export const appUsageService = {
  getClientConfig() {
    return {
      heartbeatIntervalMs: env.usageHeartbeatIntervalMs,
      inactivityThresholdMs: env.usageInactivityThresholdMs,
      timezone: env.timezone,
    };
  },

  async heartbeat(user: AuthUser, input: UsageHeartbeatInput, now = new Date()) {
    if (user.role !== Role.TRAINEE) {
      throw ApiError.forbidden();
    }

    const context = await resolveContext(user.id, input);
    const open = await appUsageRepository.findOpenByUser(user.id);

    if (open) {
      const gap = now.getTime() - open.lastHeartbeatAt.getTime();
      const age = now.getTime() - open.startedAt.getTime();
      const stale = gap > env.usageInactivityThresholdMs || age > env.usageMaxSessionMs;
      if (stale) {
        const closedAt = open.lastHeartbeatAt.getTime() < open.startedAt.getTime() ? open.startedAt : open.lastHeartbeatAt;
        await appUsageRepository.update(open.id, {
          endedAt: closedAt,
          durationSeconds: durationSeconds(open.startedAt, closedAt),
        });
      } else {
        const seconds = durationSeconds(open.startedAt, now);
        await appUsageRepository.update(open.id, {
          lastHeartbeatAt: now,
          durationSeconds: seconds,
          ...(context.programId ? { programId: context.programId } : {}),
          ...(context.batchId ? { batchId: context.batchId } : {}),
        });
        return { active: true, startedAt: open.startedAt.toISOString(), lastHeartbeatAt: now.toISOString() };
      }
    }

    try {
      const created = await appUsageRepository.create({
        userId: user.id,
        startedAt: now,
        lastHeartbeatAt: now,
        durationSeconds: 0,
        programId: context.programId,
        batchId: context.batchId,
      });
      return { active: true, startedAt: created.startedAt.toISOString(), lastHeartbeatAt: created.lastHeartbeatAt.toISOString() };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await appUsageRepository.findOpenByUser(user.id);
        if (existing) {
          await appUsageRepository.update(existing.id, {
            lastHeartbeatAt: now,
            durationSeconds: durationSeconds(existing.startedAt, now),
          });
          return { active: true, startedAt: existing.startedAt.toISOString(), lastHeartbeatAt: now.toISOString() };
        }
      }
      throw error;
    }
  },

  async closeOpenSession(userId: string, now = new Date()) {
    const open = await appUsageRepository.findOpenByUser(userId);
    if (!open) {
      return;
    }
    const recent = now.getTime() - open.lastHeartbeatAt.getTime() <= env.usageHeartbeatIntervalMs * 2;
    const closedAt = recent ? now : open.lastHeartbeatAt;
    const end = closedAt.getTime() < open.startedAt.getTime() ? open.startedAt : closedAt;
    await appUsageRepository.update(open.id, {
      endedAt: end,
      lastHeartbeatAt: recent ? end : open.lastHeartbeatAt,
      durationSeconds: durationSeconds(open.startedAt, end),
    });
  },

  async getAnalytics(
    viewer: AuthUser,
    query: {
      period?: unknown;
      date?: unknown;
      programId?: unknown;
      batchId?: unknown;
      traineeId?: unknown;
      traineeIds?: unknown;
    },
    now = new Date(),
  ): Promise<{ analytics: AppUsageAnalytics }> {
    const periodResult = query.period === undefined || query.period === "" ? "daily" : query.period;
    if (periodResult !== "daily" && periodResult !== "weekly" && periodResult !== "monthly") {
      throw ApiError.badRequest("Invalid period");
    }
    const period = periodResult;

    const timeZone = env.timezone;
    const date =
      typeof query.date === "string" && query.date.trim().length > 0
        ? parseIsoDate(query.date)
        : todayInZone(timeZone, now);
    if (!date) {
      throw ApiError.badRequest("Invalid date");
    }

    const programId = typeof query.programId === "string" && query.programId.trim() ? query.programId.trim() : undefined;
    const batchId = typeof query.batchId === "string" && query.batchId.trim() ? query.batchId.trim() : undefined;
    const requestedTraineeId =
      typeof query.traineeId === "string" && query.traineeId.trim() ? query.traineeId.trim() : undefined;
    const wantedIds = [...new Set([...(requestedTraineeId ? [requestedTraineeId] : []), ...parseIdList(query.traineeIds)])];

    if (programId && !isUuid(programId)) {
      throw ApiError.badRequest("Invalid programId");
    }
    if (batchId && !isUuid(batchId)) {
      throw ApiError.badRequest("Invalid batchId");
    }
    for (const id of wantedIds) {
      if (!isUuid(id)) {
        throw ApiError.badRequest("Invalid traineeId");
      }
    }

    if (viewer.role === Role.TRAINEE && wantedIds.some((id) => id !== viewer.id)) {
      throw ApiError.forbidden();
    }

    const scoped = await listScopedTrainees(viewer, programId, batchId);
    if (wantedIds.some((id) => !scoped.some((row) => row.id === id))) {
      throw ApiError.notFound("Trainee not found");
    }

    const selected = wantedIds.length > 0 ? scoped.filter((row) => wantedIds.includes(row.id)) : scoped;
    const { start, end, label, buckets } = resolvePeriodRange(period, date, timeZone);
    const sessions =
      selected.length === 0
        ? []
        : await appUsageRepository.findOverlapping({
            userIds: selected.map((row) => row.id),
            rangeStart: start,
            rangeEnd: end,
          });

    const secondsByUser = new Map<string, number>();
    const bucketSeconds = new Map<string, Map<string, number>>();
    for (const trainee of selected) {
      secondsByUser.set(trainee.id, 0);
      bucketSeconds.set(trainee.id, new Map(buckets.map((bucket) => [bucket.key, 0])));
    }

    for (const session of sessions) {
      const sessionEnd = effectiveEnd(session, now);
      const total = clipSeconds(session.startedAt, sessionEnd, start, end);
      secondsByUser.set(session.userId, (secondsByUser.get(session.userId) ?? 0) + total);
      const perUser = bucketSeconds.get(session.userId);
      if (!perUser) {
        continue;
      }
      for (const bucket of buckets) {
        const added = clipSeconds(session.startedAt, sessionEnd, new Date(bucket.start), new Date(bucket.end));
        perUser.set(bucket.key, (perUser.get(bucket.key) ?? 0) + added);
      }
    }

    const ranked = selected
      .map((trainee) => ({
        id: trainee.id,
        name: trainee.name,
        seconds: secondsByUser.get(trainee.id) ?? 0,
        buckets: buckets.map((bucket) => ({
          key: bucket.key,
          seconds: bucketSeconds.get(trainee.id)?.get(bucket.key) ?? 0,
        })),
      }))
      .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));

    const cap = env.usageMaxChartTrainees;
    const truncated = wantedIds.length === 0 && ranked.length > cap;
    const trainees = truncated ? ranked.slice(0, cap) : ranked;
    const active = ranked.filter((row) => row.seconds > 0);
    const totalSeconds = ranked.reduce((sum, row) => sum + row.seconds, 0);
    const mostActive = active[0] ? { id: active[0].id, name: active[0].name, seconds: active[0].seconds } : null;

    return {
      analytics: {
        period,
        timezone: timeZone,
        mode: viewer.role === Role.TRAINEE || wantedIds.length === 1 ? "individual" : "comparison",
        range: { start: start.toISOString(), end: end.toISOString(), label },
        summary: {
          totalSeconds,
          averageSeconds: active.length > 0 ? Math.round(totalSeconds / active.length) : 0,
          activeTrainees: active.length,
          mostActive: viewer.role === Role.TRAINEE ? null : mostActive,
        },
        buckets: buckets.map(({ key, label: bucketLabel, start: bucketStart, end: bucketEnd }) => ({
          key,
          label: bucketLabel,
          start: bucketStart,
          end: bucketEnd,
        })),
        trainees,
        truncated,
        filters: await listFilterOptions(viewer),
      },
    };
  },
};
