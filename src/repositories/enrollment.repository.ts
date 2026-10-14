import { CourseOutcome, EnrollmentStatus } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { ACTIVE_STATUS_FILTER } from "../utils/enrollment-status";

const progressFactsInclude = {
  completions: true,
  assessmentAttempts: {
    select: {
      quizId: true,
      status: true,
      score: true,
      passed: true,
      needsReview: true,
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
        status: ACTIVE_STATUS_FILTER,
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
      where: { userId, status: ACTIVE_STATUS_FILTER },
      include: {
        program: true,
        batch: { select: { id: true, name: true, capacity: true, startDate: true, endDate: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  findByUserForReview(userId: string) {
    return prisma.enrollment.findMany({
      where: { userId, status: ACTIVE_STATUS_FILTER },
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
        status: ACTIVE_STATUS_FILTER,
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
        status: ACTIVE_STATUS_FILTER,
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
        status: ACTIVE_STATUS_FILTER,
      },
    });
  },

  countActiveForBatch(batchId: string) {
    return prisma.enrollment.count({
      where: {
        batchId,
        status: ACTIVE_STATUS_FILTER,
      },
    });
  },

  listProgramIdsForUser(userId: string) {
    return prisma.enrollment.findMany({
      where: { userId },
      select: { programId: true, batchId: true },
    });
  },

  create(data: {
    programId: string;
    userId: string;
    enrolledByUserId?: string | null;
    batchId: string;
    joinedAt?: Date;
  }) {
    return prisma.enrollment.create({ data });
  },

  reactivate(id: string, enrolledByUserId: string, joinedAt?: Date) {
    return prisma.enrollment.update({
      where: { id },
      data: {
        status: EnrollmentStatus.ACTIVE,
        enrolledByUserId,
        joinedAt: joinedAt ?? new Date(),
        exitedAt: null,
        exitReason: "",
        exitedByUserId: null,
        handedOverAt: null,
        teamId: null,
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
      courseOutcome?: CourseOutcome;
      progressSnapshot?: object;
    },
  ) {
    return prisma.enrollment.updateMany({
      where: { id: enrollmentId, status: ACTIVE_STATUS_FILTER },
      data: input,
    });
  },
};
