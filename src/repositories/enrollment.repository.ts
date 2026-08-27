import { EnrollmentStatus } from "../generated/prisma";
import { prisma } from "../config/prisma";

const progressFactsInclude = {
  completions: true,
  assessmentAttempts: {
    select: {
      quizId: true,
      status: true,
      score: true,
      passed: true,
      submittedAt: true,
    },
  },
  assignmentSubmissions: {
    select: {
      assignmentId: true,
      status: true,
      score: true,
      submittedAt: true,
      gradedAt: true,
    },
  },
  attendances: {
    select: { status: true },
  },
  program: true,
  batch: { select: { id: true, name: true, capacity: true, startDate: true, endDate: true } },
} as const;

export const enrollmentRepository = {
  findByProgram(programId: string) {
    return prisma.enrollment.findMany({
      where: { programId },
    });
  },

  findRoster(programId: string, batchId?: string) {
    return prisma.enrollment.findMany({
      where: {
        programId,
        status: { not: EnrollmentStatus.WITHDRAWN },
        ...(batchId ? { batchId } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        batch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  findByUser(userId: string) {
    return prisma.enrollment.findMany({
      where: { userId },
      include: {
        program: true,
        batch: { select: { id: true, name: true, capacity: true, startDate: true, endDate: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  findByUserForReview(userId: string) {
    return prisma.enrollment.findMany({
      where: { userId, status: { not: EnrollmentStatus.WITHDRAWN } },
      include: {
        program: { select: { id: true, title: true, status: true, category: true } },
        batch: { select: { id: true, name: true } },
        enrolledBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  findEnrollment(batchId: string, userId: string) {
    return prisma.enrollment.findUnique({
      where: {
        batchId_userId: { batchId, userId },
      },
    });
  },

  findWithCompletions(programId: string, userId: string, batchId?: string) {
    return prisma.enrollment.findFirst({
      where: {
        programId,
        userId,
        ...(batchId ? { batchId } : {}),
      },
      include: { completions: true, program: true },
      orderBy: { createdAt: "desc" },
    });
  },

  findWithProgressFacts(programId: string, userId: string, batchId?: string) {
    return prisma.enrollment.findFirst({
      where: {
        programId,
        userId,
        status: { not: EnrollmentStatus.WITHDRAWN },
        ...(batchId ? { batchId } : {}),
      },
      include: progressFactsInclude,
      orderBy: { createdAt: "desc" },
    });
  },

  findFactsById(id: string) {
    return prisma.enrollment.findUnique({
      where: { id },
      include: progressFactsInclude,
    });
  },

  findFactsByProgram(programId: string, batchId?: string) {
    return prisma.enrollment.findMany({
      where: {
        programId,
        status: { not: EnrollmentStatus.WITHDRAWN },
        ...(batchId ? { batchId } : {}),
      },
      include: {
        ...progressFactsInclude,
        user: { select: { id: true, name: true, email: true } },
        enrolledBy: { select: { id: true, name: true, email: true } },
        batch: { select: { id: true, name: true, capacity: true, startDate: true, endDate: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  findByProgramIds(programIds: string[]) {
    if (programIds.length === 0) {
      return Promise.resolve([]);
    }

    return prisma.enrollment.findMany({
      where: { programId: { in: programIds } },
      include: {
        user: { select: { id: true, name: true, email: true } },
        program: { select: { id: true, title: true } },
        batch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  findWithUser(id: string) {
    return prisma.enrollment.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        program: { select: { id: true, title: true, createdByUserId: true } },
        batch: { select: { id: true, name: true } },
      },
    });
  },

  countActiveForProgram(programId: string) {
    return prisma.enrollment.count({
      where: {
        programId,
        status: { not: EnrollmentStatus.WITHDRAWN },
      },
    });
  },

  countActiveForBatch(batchId: string) {
    return prisma.enrollment.count({
      where: {
        batchId,
        status: { not: EnrollmentStatus.WITHDRAWN },
      },
    });
  },

  listProgramIdsForUser(userId: string) {
    return prisma.enrollment.findMany({
      where: { userId },
      select: { programId: true, batchId: true },
    });
  },

  create(data: { programId: string; userId: string; enrolledByUserId?: string | null; batchId: string }) {
    return prisma.enrollment.create({ data });
  },

  reactivate(id: string, enrolledByUserId: string) {
    return prisma.enrollment.update({
      where: { id },
      data: {
        status: EnrollmentStatus.ACTIVE,
        enrolledByUserId,
      },
    });
  },

  createMany(data: Array<{ programId: string; userId: string; enrolledByUserId?: string | null; batchId: string }>) {
    if (data.length === 0) {
      return Promise.resolve({ count: 0 });
    }

    return prisma.enrollment.createMany({
      data,
      skipDuplicates: true,
    });
  },

  updateProgress(
    enrollmentId: string,
    input: {
      overallProgress: number;
      currentWeekIndex: number;
      currentDayIndex: number;
      status: EnrollmentStatus;
      progressSnapshot?: object;
    },
  ) {
    return prisma.enrollment.updateMany({
      where: { id: enrollmentId },
      data: input,
    });
  },
};
