import { Prisma, ProgramStatus, Role } from "../generated/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programBatchRepository } from "../repositories/program-batch.repository";
import { DEFAULT_BATCH_CAPACITY, enrollmentService } from "./enrollment.service";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";

const BATCHABLE_STATUSES: ProgramStatus[] = [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED];

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function toBatchPayload(row: {
  id: string;
  programId: string;
  name: string;
  description: string;
  capacity: number;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { enrollments: number };
}) {
  const memberCount = row._count?.enrollments ?? 0;
  return {
    id: row.id,
    programId: row.programId,
    name: row.name,
    description: row.description,
    capacity: row.capacity,
    startDate: row.startDate,
    endDate: row.endDate,
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

async function requireBatchForTrainer(user: AuthUser, batchId: string) {
  return requireBatchAccess(user, batchId);
}

export const batchService = {
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

  async create(
    user: AuthUser,
    programId: string,
    input: {
      name: string;
      description?: string;
      capacity?: number;
      startDate?: string | Date | null;
      endDate?: string | Date | null;
    },
  ) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden();
    }
    const program = await programService.requireTrainerOnProgram(user, programId);
    if (!BATCHABLE_STATUSES.includes(program.status)) {
      throw ApiError.badRequest("Batches can only be created after the program is approved.");
    }
    const name = input.name.trim();
    if (!name) {
      throw ApiError.badRequest("A batch name is required.");
    }
    const capacity = input.capacity ?? DEFAULT_BATCH_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
      throw ApiError.badRequest("Capacity must be between 1 and 200.");
    }
    try {
      const created = await programBatchRepository.create({
        programId,
        name,
        description: input.description?.trim() ?? "",
        capacity,
        startDate: parseDate(input.startDate),
        endDate: parseDate(input.endDate),
        createdByUserId: user.id,
      });
      return { batch: toBatchPayload({ ...created, _count: { enrollments: 0 } }) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("A batch with that name already exists for this course.");
      }
      throw error;
    }
  },

  async update(
    user: AuthUser,
    batchId: string,
    input: {
      name?: string;
      description?: string;
      capacity?: number;
      startDate?: string | Date | null;
      endDate?: string | Date | null;
    },
  ) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden();
    }
    const batch = await requireBatchForTrainer(user, batchId);
    if (input.capacity !== undefined) {
      if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 200) {
        throw ApiError.badRequest("Capacity must be between 1 and 200.");
      }
      const members = await programBatchRepository.countMembers(batch.id);
      if (input.capacity < members) {
        throw ApiError.badRequest("Capacity cannot be lower than the number of enrolled trainees.");
      }
    }
    try {
      const saved = await programBatchRepository.update(batch.id, {
        ...("name" in input && input.name !== undefined ? { name: input.name.trim() } : {}),
        ...("description" in input && input.description !== undefined ? { description: input.description.trim() } : {}),
        ...("capacity" in input && input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...("startDate" in input ? { startDate: parseDate(input.startDate) } : {}),
        ...("endDate" in input ? { endDate: parseDate(input.endDate) } : {}),
      });
      return { batch: toBatchPayload({ ...saved, _count: batch._count }) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("A batch with that name already exists for this course.");
      }
      throw error;
    }
  },

  async remove(user: AuthUser, batchId: string) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden();
    }
    const batch = await requireBatchForTrainer(user, batchId);
    const members = await programBatchRepository.countMembers(batch.id);
    if (members > 0) {
      throw ApiError.conflict("Cannot delete a batch that has enrollments.");
    }
    await programBatchRepository.delete(batch.id);
    return { deleted: true };
  },

  async listTrainees(user: AuthUser, batchId: string) {
    const batch = await requireBatchForTrainer(user, batchId);
    const roster = await enrollmentService.buildRoster(batch.programId, batch.id);
    return {
      batch: toBatchPayload(batch),
      ...roster,
    };
  },

  async enroll(user: AuthUser, batchId: string, traineeIds: string[]) {
    const batch = await requireBatchForTrainer(user, batchId);
    return enrollmentService.enrollTrainees(user, batch.programId, traineeIds, batch.id);
  },
};
