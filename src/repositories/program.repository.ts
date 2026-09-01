import { ProgramStatus } from "../generated/prisma";
import { prisma } from "../config/prisma";

export const REVIEW_VISIBLE_PROGRAM_STATUSES: ProgramStatus[] = [
  ProgramStatus.SUBMITTED,
  ProgramStatus.REJECTED,
  ProgramStatus.APPROVED,
  ProgramStatus.PUBLISHED,
];

const personSelect = { id: true, name: true, email: true } as const;

const programTrainerInclude = {
  include: { user: { select: personSelect } },
  orderBy: { createdAt: "asc" as const },
};

const programListInclude = {
  createdBy: { select: personSelect },
  rejectedBy: { select: personSelect },
  trainers: programTrainerInclude,
  _count: { select: { weeks: true, enrollments: true } },
};

export const programTreeInclude = {
  createdBy: { select: personSelect },
  rejectedBy: { select: personSelect },
  trainers: programTrainerInclude,
  weeks: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      days: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          lessons: {
            orderBy: { sortOrder: "asc" as const },
            include: { attachments: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] } },
          },
          videos: { orderBy: { sortOrder: "asc" as const } },
          resources: { orderBy: { sortOrder: "asc" as const } },
          reels: { orderBy: { sortOrder: "asc" as const } },
          assignments: {
            orderBy: { sortOrder: "asc" as const },
            include: { attachments: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] } },
          },
          quizzes: {
            include: {
              questions: {
                orderBy: { sortOrder: "asc" as const },
                include: { options: { orderBy: { sortOrder: "asc" as const } } },
              },
            },
          },
        },
      },
      quizzes: {
        include: {
          questions: {
            orderBy: { sortOrder: "asc" as const },
            include: { options: { orderBy: { sortOrder: "asc" as const } } },
          },
        },
      },
      trainingSessions: { orderBy: { sortOrder: "asc" as const } },
    },
  },
  milestones: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      requirements: { orderBy: { sortOrder: "asc" as const } },
      exam: {
        include: {
          questions: {
            orderBy: { sortOrder: "asc" as const },
            include: { options: { orderBy: { sortOrder: "asc" as const } } },
          },
        },
      },
    },
  },
  quizzes: {
    include: {
      questions: {
        orderBy: { sortOrder: "asc" as const },
        include: { options: { orderBy: { sortOrder: "asc" as const } } },
      },
    },
  },
};

export const programRepository = {
  findById(id: string) {
    return prisma.program.findUnique({
      where: { id },
      include: {
        trainers: true,
        enrollments: true,
      },
    });
  },

  findTreeById(id: string) {
    return prisma.program.findUnique({
      where: { id },
      include: programTreeInclude,
    });
  },

  findByTrainerUserId(userId: string) {
    return prisma.program.findMany({
      where: {
        trainers: {
          some: { userId },
        },
        OR: [{ createdByUserId: userId }, { status: { not: ProgramStatus.DRAFT } }],
      },
      include: programListInclude,
      orderBy: { createdAt: "desc" },
    });
  },

  findForAdmin(status?: ProgramStatus) {
    return prisma.program.findMany({
      where: status
        ? { status }
        : { status: { in: [ProgramStatus.SUBMITTED, ProgramStatus.REJECTED, ProgramStatus.APPROVED] } },
      include: programListInclude,
      orderBy: { updatedAt: "desc" },
    });
  },

  findCatalog() {
    return prisma.program.findMany({
      where: { status: { in: REVIEW_VISIBLE_PROGRAM_STATUSES } },
      include: programListInclude,
      orderBy: { updatedAt: "desc" },
    });
  },
};
