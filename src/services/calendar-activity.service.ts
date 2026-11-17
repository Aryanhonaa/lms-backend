import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { ACTIVE_STATUS_FILTER } from "../utils/enrollment-status";
import { parseIsoDate, wallClockInZoneToUtc } from "../utils/timezone";
import type { CreateCalendarActivityInput } from "../validators/calendar.validators";

function parseStartsAt(date: string, time: string): Date {
  const parts = parseIsoDate(date);
  if (!parts) {
    throw ApiError.badRequest("Invalid date.");
  }
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw ApiError.badRequest("Invalid time.");
  }
  return wallClockInZoneToUtc(parts.year, parts.month, parts.day, hour, minute, 0, env.timezone);
}

function toActivityPayload(row: {
  id: string;
  programId: string;
  batchId: string;
  traineeUserId: string | null;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
  program: { id: string; title: string };
  batch: { id: string; name: string };
  trainee: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    programId: row.programId,
    batchId: row.batchId,
    traineeUserId: row.traineeUserId,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    program: row.program,
    batch: row.batch,
    trainee: row.trainee,
    audience: row.traineeUserId ? ("TRAINEE" as const) : ("BATCH" as const),
  };
}

const activityInclude = {
  program: { select: { id: true, title: true } },
  batch: { select: { id: true, name: true } },
  trainee: { select: { id: true, name: true } },
} as const;

export const calendarActivityService = {
  async create(user: AuthUser, input: CreateCalendarActivityInput) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    await programService.requireTrainerOnProgram(user, input.programId);

    const batch = await prisma.programBatch.findUnique({ where: { id: input.batchId } });
    if (!batch || batch.programId !== input.programId) {
      throw ApiError.badRequest("Choose a batch that belongs to this course.");
    }

    let traineeUserId: string | null = null;
    if (input.audience === "TRAINEE") {
      const enrollment = await prisma.enrollment.findFirst({
        where: {
          batchId: input.batchId,
          userId: input.traineeUserId!,
          status: ACTIVE_STATUS_FILTER,
        },
        select: { id: true },
      });
      if (!enrollment) {
        throw ApiError.badRequest("That trainee is not enrolled in this batch.");
      }
      traineeUserId = input.traineeUserId!;
    }

    const startsAt = parseStartsAt(input.date, input.time ?? "09:00");
    const created = await prisma.calendarActivity.create({
      data: {
        programId: input.programId,
        batchId: input.batchId,
        traineeUserId,
        title: input.title.trim(),
        description: input.description?.trim() ?? "",
        startsAt,
        createdByUserId: user.id,
      },
      include: activityInclude,
    });
    return { activity: toActivityPayload(created) };
  },

  async remove(user: AuthUser, activityId: string) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    const activity = await prisma.calendarActivity.findUnique({ where: { id: activityId } });
    if (!activity) {
      throw ApiError.notFound("Activity not found");
    }
    await programService.requireTrainerOnProgram(user, activity.programId);
    if (activity.createdByUserId !== user.id) {
      throw ApiError.forbidden("Only the trainer who created this activity can delete it.");
    }
    await prisma.calendarActivity.delete({ where: { id: activity.id } });
    return { deleted: true };
  },
};
