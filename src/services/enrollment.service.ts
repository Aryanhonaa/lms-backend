import { EnrollmentStatus, Prisma, ProgramStatus, Role } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { userRepository } from "../repositories/user.repository";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";

export const DEFAULT_BATCH_CAPACITY = 25;
const ENROLLABLE_STATUSES: ProgramStatus[] = [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED];

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export const enrollmentService = {
  canEnrollInto(status: ProgramStatus): boolean {
    return ENROLLABLE_STATUSES.includes(status);
  },

  async ensureVisibleEnrollments(_userId: string): Promise<void> {
    return;
  },

  async listEligibleTrainees(
    user: AuthUser,
    programId: string,
    query: string,
    skip: number,
    take: number,
    batchId?: string,
  ) {
    await programService.requireTrainerOnProgram(user, programId);
    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      throw ApiError.notFound("Program not found");
    }

    const [trainees, total] = await Promise.all([
      userRepository.searchTrainees(query, skip, take),
      userRepository.countTrainees(query),
    ]);
    const enrolledRows = batchId
      ? await enrollmentRepository.findFactsByProgram(programId, batchId)
      : await enrollmentRepository.findByProgram(programId);
    const enrolled = new Map(
      enrolledRows
        .filter((row) => row.status !== EnrollmentStatus.WITHDRAWN)
        .map((row) => [row.userId, row.status]),
    );

    return {
      canEnroll: this.canEnrollInto(program.status),
      programStatus: program.status,
      total,
      trainees: trainees.map((trainee) => {
        const status = enrolled.get(trainee.id);
        return {
          id: trainee.id,
          name: trainee.name,
          email: trainee.email,
          enrolled: Boolean(status),
        };
      }),
    };
  },

  async listProgramTrainees(user: AuthUser, programId: string) {
    await programService.requireTrainerOnProgram(user, programId);
    const rows = await enrollmentRepository.findFactsByProgram(programId);
    return {
      trainees: rows.map((row) => ({
        enrollmentId: row.id,
        status: row.status,
        progress: Number(row.overallProgress),
        enrolledAt: row.createdAt.toISOString(),
        enrolledBy: row.enrolledBy
          ? { id: row.enrolledBy.id, name: row.enrolledBy.name, email: row.enrolledBy.email }
          : null,
        trainee: { id: row.user.id, name: row.user.name, email: row.user.email },
        batch: row.batch,
      })),
    };
  },

  async enrollTrainees(user: AuthUser, programId: string, traineeIds: string[], batchId: string) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden("You don't have permission to enroll trainees in this program.");
    }

    const program = await programService.requireTrainerOnProgram(user, programId);
    if (!this.canEnrollInto(program.status)) {
      throw ApiError.badRequest("Program must be approved before trainees can be enrolled.");
    }
    if (!batchId) {
      throw ApiError.badRequest("Enroll trainees into a batch, not the course.");
    }

    const batch = await prisma.programBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.programId !== programId) {
      throw ApiError.notFound("Batch not found");
    }
    if (batch.endDate && batch.endDate.getTime() < Date.now()) {
      throw ApiError.badRequest("This batch is closed for new enrollments.");
    }

    const uniqueIds = [...new Set(traineeIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (uniqueIds.length === 0) {
      throw ApiError.badRequest("Select at least one trainee.");
    }

    let remaining = batch.capacity - (await enrollmentRepository.countActiveForBatch(batch.id));
    const enrolled: Array<{ userId: string; name: string }> = [];
    const alreadyEnrolled: Array<{ userId: string; name: string }> = [];
    const skipped: Array<{ userId: string; reason: string }> = [];

    for (const traineeId of uniqueIds) {
      const target = await userRepository.findPublicById(traineeId);
      if (!target || !target.isActive) {
        skipped.push({ userId: traineeId, reason: "Trainee not found." });
        continue;
      }
      if (target.role !== Role.TRAINEE) {
        skipped.push({ userId: traineeId, reason: "Only trainees can be enrolled." });
        continue;
      }

      const existing = await enrollmentRepository.findEnrollment(batch.id, traineeId);
      if (existing && existing.status !== EnrollmentStatus.WITHDRAWN) {
        alreadyEnrolled.push({ userId: traineeId, name: target.name });
        continue;
      }

      if (remaining <= 0) {
        skipped.push({ userId: traineeId, reason: "This batch is at capacity." });
        continue;
      }

      try {
        if (existing) {
          await enrollmentRepository.reactivate(existing.id, user.id);
        } else {
          await enrollmentRepository.create({
            programId,
            userId: traineeId,
            enrolledByUserId: user.id,
            batchId: batch.id,
          });
        }
        remaining -= 1;
        enrolled.push({ userId: traineeId, name: target.name });
      } catch (error) {
        if (isUniqueViolation(error)) {
          alreadyEnrolled.push({ userId: traineeId, name: target.name });
          continue;
        }
        throw error;
      }
    }

    return {
      enrolled,
      alreadyEnrolled,
      skipped,
      enrolledCount: enrolled.length,
      alreadyEnrolledCount: alreadyEnrolled.length,
      skippedCount: skipped.length,
    };
  },
};
