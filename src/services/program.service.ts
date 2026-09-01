import { ProgramStatus, Role } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { programRepository } from "../repositories/program.repository";
import { programTrainerRepository } from "../repositories/program-trainer.repository";
import { fileStorage } from "../storage";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";

const EDITABLE_STATUSES: ProgramStatus[] = [ProgramStatus.DRAFT, ProgramStatus.REJECTED];
const POST_APPROVAL_STATUSES: ProgramStatus[] = [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED];

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function assertCanAssignTrainers(user: AuthUser, program: { status: ProgramStatus }) {
  if (!isProgramReviewer(user.role)) {
    throw ApiError.forbidden();
  }

  if (program.status === ProgramStatus.DRAFT) {
    throw ApiError.notFound("Program not found");
  }

  if (POST_APPROVAL_STATUSES.includes(program.status) && user.role !== Role.SUPER_ADMIN) {
    throw ApiError.forbidden("Only a super admin can change trainers after a course is approved");
  }
}

async function requireAssignableProgram(programId: string) {
  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program || program.status === ProgramStatus.DRAFT) {
    throw ApiError.notFound("Program not found");
  }
  return program;
}

async function requireActiveTrainer(userId: string) {
  const trainer = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!trainer || trainer.role !== Role.TRAINER || !trainer.isActive) {
    throw ApiError.badRequest("Every assigned person must be an active trainer");
  }
  return trainer;
}

function serializeProgramTrainers(
  trainers: Awaited<ReturnType<typeof programTrainerRepository.findByProgram>>,
) {
  return trainers.map((row) => ({
    userId: row.userId,
    role: row.role,
    user: { id: row.user.id, name: row.user.name, email: row.user.email },
  }));
}

export const programService = {
  async create(
    user: AuthUser,
    input: {
      title: string;
      description: string;
      category: string;
      difficulty: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
      durationWeeks: number;
      trainingMode: "SCHEDULED" | "PROGRESSION";
      startDate?: string | Date | null;
      endDate?: string | Date | null;
      learningObjectives?: string[];
      prerequisites?: string[];
      progressThreshold?: number;
      examScoreThreshold?: number;
    },
  ) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }

    const created = await prisma.$transaction(async (tx) => {
      const program = await tx.program.create({
        data: {
          title: input.title,
          description: input.description,
          category: input.category,
          difficulty: input.difficulty,
          durationWeeks: input.durationWeeks,
          trainingMode: input.trainingMode,
          startDate: parseDate(input.startDate),
          endDate: parseDate(input.endDate),
      learningObjectives: input.learningObjectives ?? [],
      prerequisites: input.prerequisites ?? [],
      progressThreshold: input.progressThreshold ?? 60,
      examScoreThreshold: input.examScoreThreshold ?? 60,
      createdByUserId: user.id,
        },
      });

      await tx.programTrainer.create({
        data: {
          programId: program.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      return program;
    });

    return this.getTreeForUser(user, created.id);
  },

  listForTrainer(userId: string) {
    return programRepository.findByTrainerUserId(userId);
  },

  listForAdmin(status?: ProgramStatus) {
    if (status && !Object.values(ProgramStatus).includes(status)) {
      throw ApiError.badRequest("Invalid program status");
    }
    if (status === ProgramStatus.DRAFT) {
      throw ApiError.badRequest("Draft courses are visible only to the trainer who created them");
    }

    return programRepository.findForAdmin(status);
  },

  listCatalog() {
    return programRepository.findCatalog();
  },

  async getTreeForUser(user: AuthUser, programId: string) {
    const program = await programRepository.findTreeById(programId);

    if (!program) {
      throw ApiError.notFound("Program not found");
    }

    await this.assertCanView(user, program);
    return program;
  },

  async listTrainers(user: AuthUser, programId: string) {
    if (!isProgramReviewer(user.role)) {
      throw ApiError.forbidden();
    }

    const program = await requireAssignableProgram(programId);
    const trainers = await programTrainerRepository.findByProgram(programId);
    return { trainers: serializeProgramTrainers(trainers) };
  },

  async addTrainer(user: AuthUser, programId: string, trainerId: string) {
    const program = await requireAssignableProgram(programId);
    assertCanAssignTrainers(user, program);

    if (trainerId === program.createdByUserId) {
      throw ApiError.badRequest("The course owner is already assigned as the primary trainer");
    }

    await requireActiveTrainer(trainerId);

    await prisma.programTrainer.upsert({
      where: { programId_userId: { programId, userId: trainerId } },
      create: { programId, userId: trainerId, role: "CO_TRAINER" },
      update: { role: "CO_TRAINER" },
    });

    return this.listTrainers(user, programId);
  },

  async setTrainers(user: AuthUser, programId: string, trainerIds: string[]) {
    const program = await requireAssignableProgram(programId);
    assertCanAssignTrainers(user, program);

    const uniqueIds = [...new Set(trainerIds)];
    const coTrainerIds = uniqueIds.filter((id) => id !== program.createdByUserId);

    if (coTrainerIds.length > 0) {
      const trainers = await prisma.user.findMany({
        where: { id: { in: coTrainerIds } },
        select: { id: true, role: true, isActive: true },
      });
      const byId = new Map(trainers.map((row) => [row.id, row]));
      for (const id of coTrainerIds) {
        const trainer = byId.get(id);
        if (!trainer || trainer.role !== Role.TRAINER || !trainer.isActive) {
          throw ApiError.badRequest("Every assigned person must be an active trainer");
        }
      }
    }

    await programTrainerRepository.replaceCoTrainers(programId, program.createdByUserId, coTrainerIds);
    return this.getTreeForUser(user, programId);
  },

  async update(
    user: AuthUser,
    programId: string,
    input: Partial<{
      title: string;
      description: string;
      category: string;
      difficulty: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
      durationWeeks: number;
      trainingMode: "SCHEDULED" | "PROGRESSION";
      startDate: string | Date | null;
      endDate: string | Date | null;
      learningObjectives: string[];
      prerequisites: string[];
      progressThreshold: number;
      examScoreThreshold: number;
    }>,
  ) {
    const program = await this.requireEditable(user, programId);

    await prisma.program.update({
      where: { id: program.id },
      data: {
        ...("title" in input ? { title: input.title } : {}),
        ...("description" in input ? { description: input.description } : {}),
        ...("category" in input ? { category: input.category } : {}),
        ...("difficulty" in input ? { difficulty: input.difficulty } : {}),
        ...("durationWeeks" in input ? { durationWeeks: input.durationWeeks } : {}),
        ...("trainingMode" in input ? { trainingMode: input.trainingMode } : {}),
        ...("learningObjectives" in input ? { learningObjectives: input.learningObjectives } : {}),
        ...("prerequisites" in input ? { prerequisites: input.prerequisites } : {}),
        ...("startDate" in input ? { startDate: parseDate(input.startDate) } : {}),
        ...("endDate" in input ? { endDate: parseDate(input.endDate) } : {}),
        ...("progressThreshold" in input && input.progressThreshold !== undefined
          ? { progressThreshold: input.progressThreshold }
          : {}),
        ...("examScoreThreshold" in input && input.examScoreThreshold !== undefined
          ? { examScoreThreshold: input.examScoreThreshold }
          : {}),
      },
    });

    return this.getTreeForUser(user, programId);
  },

  async submit(user: AuthUser, programId: string) {
    const program = await this.requireOwned(user, programId);

    if (program.status !== ProgramStatus.DRAFT && program.status !== ProgramStatus.REJECTED) {
      throw ApiError.badRequest("Only draft or rejected programs can be submitted");
    }

    const weekCount = await prisma.week.count({ where: { programId } });
    if (weekCount < 1) {
      throw ApiError.badRequest("Add at least one week before submitting");
    }

    await prisma.program.update({
      where: { id: programId },
      data: { status: ProgramStatus.SUBMITTED },
    });

    return this.getTreeForUser(user, programId);
  },

  async approve(user: AuthUser, programId: string) {
    if (!isProgramReviewer(user.role)) {
      throw ApiError.forbidden();
    }

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      throw ApiError.notFound("Program not found");
    }

    if (program.createdByUserId === user.id) {
      throw ApiError.forbidden("A trainer cannot approve their own program");
    }

    if (program.status !== ProgramStatus.SUBMITTED) {
      throw ApiError.badRequest("Only submitted programs can be approved");
    }

    await prisma.program.update({
      where: { id: programId },
      data: {
        status: ProgramStatus.APPROVED,
        rejectionReason: null,
        rejectedAt: null,
        rejectedByUserId: null,
      },
    });

    return this.getTreeForUser(user, programId);
  },

  async reject(user: AuthUser, programId: string, reason: string) {
    if (!isProgramReviewer(user.role)) {
      throw ApiError.forbidden();
    }

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      throw ApiError.notFound("Program not found");
    }

    if (program.createdByUserId === user.id) {
      throw ApiError.forbidden("A trainer cannot reject their own program");
    }

    if (program.status !== ProgramStatus.SUBMITTED) {
      throw ApiError.badRequest("Only submitted programs can be rejected");
    }

    await prisma.program.update({
      where: { id: programId },
      data: {
        status: ProgramStatus.REJECTED,
        rejectionReason: reason,
        rejectedAt: new Date(),
        rejectedByUserId: user.id,
      },
    });

    return this.getTreeForUser(user, programId);
  },

  async remove(user: AuthUser, programId: string): Promise<{ deleted: true }> {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: { _count: { select: { enrollments: true } } },
    });
    if (!program) {
      throw ApiError.notFound("Program not found");
    }

    const draftLike = program.status === ProgramStatus.DRAFT || program.status === ProgramStatus.REJECTED;
    const approvedLike = program.status === ProgramStatus.APPROVED || program.status === ProgramStatus.PUBLISHED;

    if (user.role === "TRAINER") {
      if (program.createdByUserId !== user.id) {
        throw ApiError.forbidden();
      }
      if (!draftLike) {
        throw ApiError.badRequest("Trainers can only delete draft or rejected courses.");
      }
    } else if (isProgramReviewer(user.role)) {
      if (program.status === ProgramStatus.DRAFT) {
        throw ApiError.notFound("Program not found");
      }
      if (!approvedLike) {
        throw ApiError.badRequest("Admins can only delete approved or published courses.");
      }
    } else {
      throw ApiError.forbidden();
    }

    if (program._count.enrollments > 0) {
      throw ApiError.badRequest(
        "This course has enrolled trainees. Remove those enrollments before deleting the course.",
      );
    }

    const keys = await collectProgramStorageKeys(programId);
    await prisma.program.delete({ where: { id: programId } });
    for (const key of new Set(keys)) {
      await fileStorage.delete(key).catch(() => undefined);
    }
    return { deleted: true };
  },

  async updateInterventionSettings(
    user: AuthUser,
    programId: string,
    input: { progressThreshold?: number; examScoreThreshold?: number },
  ) {
    await this.requireTrainerOnProgram(user, programId);
    await prisma.program.update({
      where: { id: programId },
      data: {
        ...(input.progressThreshold !== undefined ? { progressThreshold: input.progressThreshold } : {}),
        ...(input.examScoreThreshold !== undefined ? { examScoreThreshold: input.examScoreThreshold } : {}),
      },
    });
    return this.getTreeForUser(user, programId);
  },

  async requireTrainerOnProgram(user: AuthUser, programId: string) {
    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      throw ApiError.notFound("Program not found");
    }

    if (program.status === ProgramStatus.DRAFT) {
      if (user.role === "TRAINER" && program.createdByUserId === user.id) {
        return program;
      }
      throw ApiError.notFound("Program not found");
    }

    if (user.role === "SUPER_ADMIN") {
      return program;
    }

    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }

    const membership = await prisma.programTrainer.findUnique({
      where: { programId_userId: { programId, userId: user.id } },
    });
    if (!membership) {
      throw ApiError.forbidden();
    }

    return program;
  },

  async listProgramIdsForTrainer(userId: string) {
    const rows = await prisma.programTrainer.findMany({
      where: {
        userId,
        OR: [{ program: { createdByUserId: userId } }, { program: { status: { not: ProgramStatus.DRAFT } } }],
      },
      select: { programId: true },
    });
    return rows.map((row) => row.programId);
  },

  async requireOwned(user: AuthUser, programId: string) {
    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      throw ApiError.notFound("Program not found");
    }

    if (user.role !== "TRAINER" || program.createdByUserId !== user.id) {
      throw ApiError.forbidden();
    }

    return program;
  },

  async requireEditable(user: AuthUser, programId: string) {
    const program = await this.requireOwned(user, programId);

    if (!EDITABLE_STATUSES.includes(program.status)) {
      throw ApiError.badRequest("Program cannot be edited in its current status");
    }

    return program;
  },

  async assertCanView(
    user: AuthUser,
    program: { id: string; status: ProgramStatus; createdByUserId: string },
  ) {
    if (program.status === ProgramStatus.DRAFT) {
      if (user.role === "TRAINER" && program.createdByUserId === user.id) {
        return;
      }
      throw ApiError.notFound("Program not found");
    }

    if (isProgramReviewer(user.role)) {
      return;
    }

    if (user.role === "TRAINER") {
      if (program.createdByUserId === user.id) {
        return;
      }
      const membership = await prisma.programTrainer.findUnique({
        where: { programId_userId: { programId: program.id, userId: user.id } },
      });
      if (membership) {
        return;
      }
    }

    throw ApiError.forbidden();
  },

  async requireCanView(user: AuthUser, programId: string) {
    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      throw ApiError.notFound("Program not found");
    }
    await this.assertCanView(user, program);
    return program;
  },
};

async function collectProgramStorageKeys(programId: string): Promise<string[]> {
  const where = { day: { week: { programId } } };
  const [videos, resources, reels, lessonAttachments, assignmentAttachments, submissionFiles, certificates] =
    await Promise.all([
      prisma.video.findMany({ where: { ...where, fileKey: { not: null } }, select: { fileKey: true } }),
      prisma.resource.findMany({ where: { ...where, fileKey: { not: null } }, select: { fileKey: true } }),
      prisma.reel.findMany({ where: { ...where, fileKey: { not: null } }, select: { fileKey: true } }),
      prisma.contentAttachment.findMany({ where: { lesson: where }, select: { fileKey: true } }),
      prisma.contentAttachment.findMany({ where: { assignment: where }, select: { fileKey: true } }),
      prisma.assignmentSubmissionFile.findMany({
        where: { submission: { assignment: where } },
        select: { fileKey: true },
      }),
      prisma.certificate.findMany({
        where: { programId, documentKey: { not: null } },
        select: { documentKey: true },
      }),
    ]);

  const keys: string[] = [];
  for (const row of [...videos, ...resources, ...reels]) {
    if (row.fileKey) {
      keys.push(row.fileKey);
    }
  }
  keys.push(
    ...lessonAttachments.map((row) => row.fileKey),
    ...assignmentAttachments.map((row) => row.fileKey),
    ...submissionFiles.map((row) => row.fileKey),
  );
  for (const row of certificates) {
    if (row.documentKey) {
      keys.push(row.documentKey);
    }
  }
  return keys;
}
