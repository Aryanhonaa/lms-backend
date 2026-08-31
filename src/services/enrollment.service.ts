import { EnrollmentStatus, Prisma, ProgramStatus, Role } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programRepository } from "../repositories/program.repository";
import { userRepository } from "../repositories/user.repository";
import { programService } from "./program.service";
import { traineeRosterCounts, type TraineeRosterRow } from "./trainee-roster";
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

  async buildRoster(programId: string, batchId?: string) {
    const program = await programRepository.findTreeById(programId);
    if (!program) {
      throw ApiError.notFound("Program not found");
    }
    const { progressService } = await import("./progress.service");
    const rows = await enrollmentRepository.findFactsByProgram(programId, batchId);
    const trainees: TraineeRosterRow[] = rows.map((row) => {
      const view = progressService.compute(program, row.id, progressService.factsFromEnrollment(row));
      return {
        enrollmentId: row.id,
        status: view.enrollment.status,
        progress: view.progress.percent,
        courseOutcome: view.course.outcome,
        courseStatus: view.course.courseStatus,
        failedAssessments: view.course.failedAssessments,
        lastActivityAt: view.course.lastActivityAt,
        finishedAt: view.course.finishedAt,
        enrolledAt: row.createdAt.toISOString(),
        enrolledBy: row.enrolledBy
          ? { id: row.enrolledBy.id, name: row.enrolledBy.name, email: row.enrolledBy.email }
          : null,
        trainee: { id: row.user.id, name: row.user.name, email: row.user.email },
        batch: row.batch ? { id: row.batch.id, name: row.batch.name } : null,
      };
    });
    return { trainees, counts: traineeRosterCounts(trainees) };
  },

  async listProgramTrainees(user: AuthUser, programId: string) {
    await programService.requireTrainerOnProgram(user, programId);
    return this.buildRoster(programId);
  },

  async listTrainerTrainees(user: AuthUser, filterProgramId?: string) {
    const programIds = await programService.listProgramIdsForTrainer(user.id);
    const programs = await prisma.program.findMany({
      where: { id: { in: programIds } },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    });

    if (programIds.length === 0) {
      return { programs: [], trainees: [], counts: traineeRosterCounts([]) };
    }

    let targetProgramIds = programIds;
    if (filterProgramId) {
      if (!programIds.includes(filterProgramId)) {
        throw ApiError.forbidden("You don't have access to this program.");
      }
      targetProgramIds = [filterProgramId];
    }

    const programTitleById = new Map(programs.map((program) => [program.id, program.title]));
    const trainees: Array<TraineeRosterRow & { program: { id: string; title: string } }> = [];

    for (const programId of targetProgramIds) {
      const roster = await this.buildRoster(programId);
      for (const row of roster.trainees) {
        trainees.push({
          ...row,
          program: { id: programId, title: programTitleById.get(programId) ?? "Unknown" },
        });
      }
    }

    trainees.sort((left, right) => {
      const byName = left.trainee.name.localeCompare(right.trainee.name);
      if (byName !== 0) {
        return byName;
      }
      return left.program.title.localeCompare(right.program.title);
    });

    return {
      programs,
      trainees,
      counts: traineeRosterCounts(trainees),
    };
  },

  async getEnrollmentProgress(user: AuthUser, enrollmentId: string) {
    const { progressService } = await import("./progress.service");
    const enrollment = await enrollmentRepository.findFactsById(enrollmentId);
    if (!enrollment) {
      throw ApiError.notFound("Enrollment not found");
    }
    const progress = await progressService.getProgressViewForEnrollment(user, enrollmentId);
    const trainee = await userRepository.findPublicById(enrollment.userId);
    if (!trainee) {
      throw ApiError.notFound("Trainee not found");
    }
    return {
      enrollmentId: enrollment.id,
      enrolledAt: enrollment.createdAt.toISOString(),
      trainee: { id: trainee.id, name: trainee.name, email: trainee.email },
      batch: enrollment.batch ? { id: enrollment.batch.id, name: enrollment.batch.name } : null,
      progress,
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
