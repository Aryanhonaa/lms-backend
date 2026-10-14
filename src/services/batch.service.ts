import { BatchTrainerRole, EnrollmentStatus, LineOfBusiness, Prisma, ProgramStatus, Role } from "../generated/prisma";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { programBatchRepository } from "../repositories/program-batch.repository";
import { DEFAULT_BATCH_CAPACITY, enrollmentService } from "./enrollment.service";
import { programService } from "./program.service";
import { workCalendarService } from "./work-calendar.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { buildBatchCode } from "../utils/batch-code";
import { isProgramReviewer } from "../utils/roles";
import { zonedYmd } from "../utils/timezone";
import { TRAINING_WORKING_DAYS, addWorkingDays, skippedDays } from "../utils/working-days";

const BATCHABLE_STATUSES: ProgramStatus[] = [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED];

type BatchInput = {
  name?: string;
  description?: string;
  capacity?: number;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  lineOfBusiness?: LineOfBusiness | null;
  month?: number | null;
  year?: number | null;
  batchNumber?: number | null;
  salesTrainerId?: string | null;
  supportTrainerId?: string | null;
  actualCompletionDate?: string | Date | null;
};

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function ymd(date: Date): string {
  return zonedYmd(date, env.timezone);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type BatchRow = {
  id: string;
  programId: string;
  name: string;
  description: string;
  capacity: number;
  startDate: Date | null;
  endDate: Date | null;
  code: string | null;
  month: number | null;
  year: number | null;
  batchNumber: number | null;
  lineOfBusiness: LineOfBusiness | null;
  actualCompletionDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  trainers?: Array<{ role: BatchTrainerRole; user: { id: string; name: string; email: string } }>;
  _count?: { enrollments: number };
};

function toBatchPayload(row: BatchRow) {
  const memberCount = row._count?.enrollments ?? 0;
  const trainerFor = (role: BatchTrainerRole) => row.trainers?.find((item) => item.role === role)?.user ?? null;
  return {
    id: row.id,
    programId: row.programId,
    name: row.name,
    description: row.description,
    capacity: row.capacity,
    startDate: row.startDate,
    endDate: row.endDate,
    code: row.code,
    month: row.month,
    year: row.year,
    batchNumber: row.batchNumber,
    lineOfBusiness: row.lineOfBusiness,
    actualCompletionDate: row.actualCompletionDate,
    salesTrainer: trainerFor(BatchTrainerRole.SALES),
    supportTrainer: trainerFor(BatchTrainerRole.SALES_SUPPORT),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    memberCount,
    remaining: Math.max(0, row.capacity - memberCount),
  };
}

async function requireBatchAccess(user: AuthUser, batchId: string) {
  const batch = await programBatchRepository.findById(batchId);
  if (!batch) {
    throw ApiError.notFound("Batch not found");
  }
  if (isProgramReviewer(user.role)) {
    await programService.requireCanView(user, batch.programId);
  } else {
    await programService.requireTrainerOnProgram(user, batch.programId);
  }
  return batch;
}

function canManageBatch(
  user: AuthUser,
  batch: { createdByUserId: string; trainers: Array<{ userId: string }> },
): boolean {
  if (user.role !== Role.TRAINER) {
    return true;
  }
  if (batch.trainers.length === 0 || batch.createdByUserId === user.id) {
    return true;
  }
  return batch.trainers.some((trainer) => trainer.userId === user.id);
}

async function requireBatchManage(user: AuthUser, batchId: string) {
  const batch = await requireBatchAccess(user, batchId);
  if (!canManageBatch(user, batch)) {
    throw ApiError.forbidden("Only this batch's trainers can change its trainees.");
  }
  return batch;
}

async function assertProgramTrainer(programId: string, userId: string | null | undefined) {
  if (!userId) {
    return;
  }
  const membership = await prisma.programTrainer.findUnique({
    where: { programId_userId: { programId, userId } },
  });
  if (!membership) {
    throw ApiError.badRequest("Batch trainers must be assigned to this program first.");
  }
}

function validateCapacity(capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
    throw ApiError.badRequest("Capacity must be between 1 and 200.");
  }
}

async function resolveCodeParts(input: BatchInput, startDate: Date | null) {
  const anchor = startDate ? ymd(startDate) : ymd(new Date());
  const month = input.month ?? Number(anchor.slice(5, 7));
  const year = input.year ?? Number(anchor.slice(0, 4));
  const batchNumber = input.batchNumber ?? (await programBatchRepository.nextBatchNumber(month, year));
  return { month, year, batchNumber, code: buildBatchCode(month, year, batchNumber) };
}

async function applyTrainers(programId: string, batchId: string, input: BatchInput) {
  if ("salesTrainerId" in input) {
    await assertProgramTrainer(programId, input.salesTrainerId);
    await programBatchRepository.setTrainer(batchId, BatchTrainerRole.SALES, input.salesTrainerId ?? null);
  }
  if ("supportTrainerId" in input) {
    await assertProgramTrainer(programId, input.supportTrainerId);
    await programBatchRepository.setTrainer(batchId, BatchTrainerRole.SALES_SUPPORT, input.supportTrainerId ?? null);
  }
}

export const batchService = {
  requireBatchAccess,
  requireBatchManage,
  canManageBatch,
  toBatchPayload,

  async listForProgram(user: AuthUser, programId: string) {
    if (isProgramReviewer(user.role)) {
      await programService.requireCanView(user, programId);
    } else {
      await programService.requireTrainerOnProgram(user, programId);
    }
    const batches = await programBatchRepository.listForProgram(programId);
    return {
      batches: batches.map(toBatchPayload),
    };
  },

  async previewCode(input: { startDate?: string; batchNumber?: number; month?: number; year?: number }) {
    const startDate = parseDate(input.startDate);
    const parts = await resolveCodeParts(input, startDate);
    if (!startDate) {
      return { ...parts, targetCompletionDate: null, skipped: null };
    }
    const calendar = await workCalendarService.load();
    const startYmd = ymd(startDate);
    const target = addWorkingDays(startYmd, TRAINING_WORKING_DAYS, calendar);
    const skipped = skippedDays(startYmd, target, calendar);
    const holidayNames = await prisma.holiday.findMany({
      where: { date: { in: skipped.holidays.map((day) => new Date(`${day}T00:00:00Z`)) } },
      select: { date: true, name: true },
      orderBy: { date: "asc" },
    });
    return {
      ...parts,
      targetCompletionDate: target,
      skipped: {
        weeklyOff: skipped.weeklyOff,
        holidays: holidayNames.map((row) => ({ date: row.date.toISOString().slice(0, 10), name: row.name })),
      },
    };
  },

  async create(user: AuthUser, programId: string, input: BatchInput) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden();
    }
    const program = await programService.requireTrainerOnProgram(user, programId);
    if (!BATCHABLE_STATUSES.includes(program.status)) {
      throw ApiError.badRequest("Batches can only be created after the program is approved.");
    }
    const capacity = input.capacity ?? DEFAULT_BATCH_CAPACITY;
    validateCapacity(capacity);

    const startDate = parseDate(input.startDate);
    const tracked = Boolean(input.lineOfBusiness);
    const codeParts = tracked ? await resolveCodeParts(input, startDate) : null;
    const name = input.name?.trim() || codeParts?.code || "";
    if (!name) {
      throw ApiError.badRequest("A batch name is required.");
    }
    await assertProgramTrainer(programId, input.salesTrainerId);
    await assertProgramTrainer(programId, input.supportTrainerId);

    try {
      const created = await programBatchRepository.create({
        programId,
        name,
        description: input.description?.trim() ?? "",
        capacity,
        startDate,
        endDate: parseDate(input.endDate),
        createdByUserId: user.id,
        ...(codeParts
          ? {
              code: codeParts.code,
              month: codeParts.month,
              year: codeParts.year,
              batchNumber: codeParts.batchNumber,
              lineOfBusiness: input.lineOfBusiness,
            }
          : {}),
      });
      await applyTrainers(programId, created.id, input);
      const saved = await programBatchRepository.findById(created.id);
      return { batch: toBatchPayload(saved ?? { ...created, _count: { enrollments: 0 } }) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("A batch with that name or code already exists.");
      }
      throw error;
    }
  },

  async update(user: AuthUser, batchId: string, input: BatchInput) {
    if (user.role !== Role.TRAINER && !isProgramReviewer(user.role)) {
      throw ApiError.forbidden();
    }
    const batch = await requireBatchAccess(user, batchId);
    if (input.capacity !== undefined) {
      validateCapacity(input.capacity);
      const members = await programBatchRepository.countMembers(batch.id);
      if (input.capacity < members) {
        throw ApiError.badRequest("Capacity cannot be lower than the number of enrolled trainees.");
      }
    }

    const lineOfBusiness = "lineOfBusiness" in input ? input.lineOfBusiness ?? null : batch.lineOfBusiness;
    const codeChanged =
      input.month !== undefined ||
      input.year !== undefined ||
      input.batchNumber !== undefined ||
      ("lineOfBusiness" in input && Boolean(input.lineOfBusiness) && !batch.code);
    let codeFields = {};
    if (lineOfBusiness && codeChanged) {
      const startDate = "startDate" in input ? parseDate(input.startDate) : batch.startDate;
      const parts = await resolveCodeParts(
        {
          month: input.month ?? batch.month,
          year: input.year ?? batch.year,
          batchNumber: input.batchNumber ?? batch.batchNumber,
        },
        startDate,
      );
      codeFields = { code: parts.code, month: parts.month, year: parts.year, batchNumber: parts.batchNumber };
    }

    try {
      await programBatchRepository.update(batch.id, {
        ...(input.name !== undefined && input.name.trim() ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...("startDate" in input ? { startDate: parseDate(input.startDate) } : {}),
        ...("endDate" in input ? { endDate: parseDate(input.endDate) } : {}),
        ...("lineOfBusiness" in input ? { lineOfBusiness } : {}),
        ...("actualCompletionDate" in input ? { actualCompletionDate: parseDate(input.actualCompletionDate) } : {}),
        ...codeFields,
      });
      await applyTrainers(batch.programId, batch.id, input);
      const saved = await programBatchRepository.findById(batch.id);
      return { batch: toBatchPayload(saved ?? batch) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("A batch with that name or code already exists.");
      }
      throw error;
    }
  },

  async remove(user: AuthUser, batchId: string) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden();
    }
    const batch = await requireBatchAccess(user, batchId);
    const members = await prisma.enrollment.count({
      where: { batchId: batch.id, status: { not: EnrollmentStatus.REMOVED } },
    });
    if (members > 0) {
      throw ApiError.conflict("Cannot delete a batch that has enrollments.");
    }
    await prisma.$transaction([
      prisma.enrollment.deleteMany({ where: { batchId: batch.id, status: EnrollmentStatus.REMOVED } }),
      prisma.programBatch.delete({ where: { id: batch.id } }),
    ]);
    return { deleted: true };
  },

  async listTrainees(user: AuthUser, batchId: string) {
    const batch = await requireBatchAccess(user, batchId);
    const roster = await enrollmentService.buildRoster(batch.programId, batch.id);
    return {
      batch: toBatchPayload(batch),
      ...roster,
    };
  },

  async enroll(user: AuthUser, batchId: string, traineeIds: string[], joinedAt?: Date) {
    const batch = await requireBatchAccess(user, batchId);
    return enrollmentService.enrollTrainees(user, batch.programId, traineeIds, batch.id, joinedAt);
  },
};
