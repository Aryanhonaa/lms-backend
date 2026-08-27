import {
  InterventionStatus,
  InterventionTrigger,
  type Prisma,
} from "../generated/prisma";
import { prisma } from "../config/prisma";

const flagInclude = {
  enrollment: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
  program: { select: { id: true, title: true, progressThreshold: true, examScoreThreshold: true } },
  quiz: { select: { id: true, title: true, kind: true } },
  requirements: {
    select: { id: true, status: true },
  },
} as const;

export const interventionRepository = {
  findById(id: string) {
    return prisma.interventionFlag.findUnique({
      where: { id },
      include: flagInclude,
    });
  },

  findOpen(enrollmentId: string, trigger: InterventionTrigger, quizId?: string | null) {
    return prisma.interventionFlag.findFirst({
      where: {
        enrollmentId,
        trigger,
        status: InterventionStatus.OPEN,
        ...(trigger === InterventionTrigger.EXAM_SCORE_BELOW_THRESHOLD ? { quizId: quizId ?? null } : {}),
      },
    });
  },

  listForPrograms(programIds: string[], status?: InterventionStatus) {
    if (programIds.length === 0) {
      return Promise.resolve([]);
    }

    return prisma.interventionFlag.findMany({
      where: {
        programId: { in: programIds },
        ...(status ? { status } : {}),
      },
      include: flagInclude,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
  },

  create(data: {
    enrollmentId: string;
    programId: string;
    trigger: InterventionTrigger;
    progressPercent: number;
    examScore?: number | null;
    quizId?: string | null;
    attemptId?: string | null;
  }) {
    return prisma.interventionFlag.create({
      data: {
        enrollmentId: data.enrollmentId,
        programId: data.programId,
        trigger: data.trigger,
        progressPercent: data.progressPercent,
        examScore: data.examScore ?? null,
        quizId: data.quizId ?? null,
        attemptId: data.attemptId ?? null,
      },
      include: flagInclude,
    });
  },

  updateStatus(id: string, status: InterventionStatus) {
    const data: Prisma.InterventionFlagUpdateInput = { status };
    if (status === InterventionStatus.ACKNOWLEDGED) {
      data.acknowledgedAt = new Date();
    }
    if (status === InterventionStatus.RESOLVED) {
      data.resolvedAt = new Date();
    }
    return prisma.interventionFlag.update({
      where: { id },
      data,
      include: flagInclude,
    });
  },

  resolveOpen(enrollmentId: string, trigger: InterventionTrigger, quizId?: string | null) {
    return prisma.interventionFlag.updateMany({
      where: {
        enrollmentId,
        trigger,
        status: InterventionStatus.OPEN,
        ...(trigger === InterventionTrigger.EXAM_SCORE_BELOW_THRESHOLD && quizId ? { quizId } : {}),
      },
      data: {
        status: InterventionStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });
  },
};
