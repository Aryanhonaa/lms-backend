import { AnnouncementAudience, EnrollmentStatus, Role } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { announcementRepository } from "../repositories/engagement.repository";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programBatchRepository } from "../repositories/program-batch.repository";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";

type CreateInput = {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  programId?: string | null;
  batchId?: string | null;
  traineeIds?: string[];
};

function uniqueIds(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((id) => id.trim()).filter(Boolean))];
}

function toPayload(
  row: Awaited<ReturnType<typeof announcementRepository.create>>,
  options?: { includeRecipients?: boolean },
) {
  const includeRecipients = options?.includeRecipients !== false;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    program: row.program,
    batch: row.batch,
    recipients: includeRecipients
      ? row.recipients.map((item) => ({ id: item.user.id, name: item.user.name }))
      : [],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export const announcementService = {
  async create(user: AuthUser, input: CreateInput) {
    if (user.role === Role.TRAINEE) {
      throw ApiError.forbidden();
    }

    if (user.role === Role.TRAINER) {
      if (
        (input.audience !== AnnouncementAudience.PROGRAM &&
          input.audience !== AnnouncementAudience.TRAINEES_SELECTED) ||
        !input.programId
      ) {
        throw ApiError.badRequest("Trainers can only announce to a program they operate");
      }
      await programService.requireTrainerOnProgram(user, input.programId);
    }

    let programId = input.programId ?? null;
    let batchId: string | null = null;
    let traineeIds: string[] = [];

    if (input.audience === AnnouncementAudience.PROGRAM) {
      if (!programId) {
        throw ApiError.badRequest("Program announcements need a program");
      }
      if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) {
        await programService.requireCanView(user, programId);
      }
    } else if (input.audience === AnnouncementAudience.TRAINEES_SELECTED) {
      traineeIds = uniqueIds(input.traineeIds);
      if (!programId || !input.batchId || traineeIds.length === 0) {
        throw ApiError.badRequest("Choose a batch and at least one trainee");
      }
      const batch = await programBatchRepository.findById(input.batchId);
      if (!batch || batch.programId !== programId) {
        throw ApiError.badRequest("That batch does not belong to this program");
      }
      if (isProgramReviewer(user.role)) {
        await programService.requireCanView(user, programId);
      } else {
        await programService.requireTrainerOnProgram(user, programId);
      }
      const enrolled = await prisma.enrollment.findMany({
        where: {
          batchId: batch.id,
          userId: { in: traineeIds },
          status: { not: EnrollmentStatus.WITHDRAWN },
        },
        select: { userId: true },
      });
      if (enrolled.length !== traineeIds.length) {
        throw ApiError.badRequest("Every selected person must be in that batch");
      }
      batchId = batch.id;
    } else {
      programId = null;
    }

    const created = await announcementRepository.create({
      title: input.title.trim(),
      body: input.body.trim(),
      audience: input.audience,
      programId,
      batchId,
      createdByUserId: user.id,
      traineeIds,
    });
    return { announcement: toPayload(created) };
  },

  async listForUser(user: AuthUser) {
    const rows = await announcementRepository.listRecent(80);
    const trainerPrograms =
      user.role === Role.TRAINER ? (await programService.listForTrainer(user.id)).map((row) => row.id) : [];
    const traineePrograms =
      user.role === Role.TRAINEE
        ? (await enrollmentRepository.findByUser(user.id)).map((row) => row.programId)
        : [];

    const announcements = rows.filter((row) => {
      if (isProgramReviewer(user.role)) {
        return true;
      }
      if (row.audience === AnnouncementAudience.EVERYONE) {
        return true;
      }
      if (row.audience === AnnouncementAudience.TRAINERS) {
        return user.role === Role.TRAINER;
      }
      if (row.audience === AnnouncementAudience.TRAINEES) {
        return user.role === Role.TRAINEE;
      }
      if (row.audience === AnnouncementAudience.PROGRAM && row.programId) {
        if (user.role === Role.TRAINER) {
          return trainerPrograms.includes(row.programId);
        }
        if (user.role === Role.TRAINEE) {
          return traineePrograms.includes(row.programId);
        }
      }
      if (row.audience === AnnouncementAudience.TRAINEES_SELECTED) {
        if (user.role === Role.TRAINER) {
          return Boolean(row.programId && trainerPrograms.includes(row.programId));
        }
        if (user.role === Role.TRAINEE) {
          return row.recipients.some((item) => item.userId === user.id);
        }
      }
      return false;
    });

    const includeRecipients = user.role !== Role.TRAINEE;
    return { announcements: announcements.map((row) => toPayload(row, { includeRecipients })) };
  },

  async inbox(user: AuthUser) {
    const { announcements } = await this.listForUser(user);
    const ids = announcements.map((item) => item.id);
    const reads = await announcementRepository.listReadIds(user.id, ids);
    const readSet = new Set(reads.map((row) => row.announcementId));
    const href = user.role === Role.TRAINEE ? "/trainee/announcements" : "/trainer/announcements";

    const notifications = announcements.slice(0, 12).map((item) => {
      const createdAt = item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt);
      const isOwn = item.createdBy.id === user.id;
      return {
        id: item.id,
        title: item.title,
        body: item.body,
        programTitle: item.program?.title ?? item.batch?.name ?? null,
        createdAt,
        read: isOwn || readSet.has(item.id),
        href,
      };
    });

    const unreadCount = announcements.filter((item) => item.createdBy.id !== user.id && !readSet.has(item.id)).length;
    return { unreadCount, notifications };
  },

  async markRead(user: AuthUser, requestedIds?: string[]) {
    const { announcements } = await this.listForUser(user);
    const allowed = new Set(announcements.map((item) => item.id));
    const ids = (requestedIds?.length ? requestedIds : announcements.map((item) => item.id)).filter((id) => allowed.has(id));
    await announcementRepository.markRead(user.id, ids);
    return this.inbox(user);
  },
};
