import type { BatchTrainerRole, LineOfBusiness } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { ACTIVE_STATUS_FILTER } from "../utils/enrollment-status";

const batchTrainersInclude = {
  include: { user: { select: { id: true, name: true, email: true } } },
  orderBy: { role: "asc" as const },
};

type BatchTrackerFields = {
  code?: string | null;
  month?: number | null;
  year?: number | null;
  batchNumber?: number | null;
  lineOfBusiness?: LineOfBusiness | null;
  actualCompletionDate?: Date | null;
};

export const programBatchRepository = {
  findById(id: string) {
    return prisma.programBatch.findUnique({
      where: { id },
      include: {
        program: { select: { id: true, title: true, status: true } },
        trainers: batchTrainersInclude,
        linkedBatches: {
          select: {
            id: true,
            programId: true,
            sortOrder: true,
            createdAt: true,
            program: { select: { id: true, title: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        _count: { select: { enrollments: { where: { status: ACTIVE_STATUS_FILTER } } } },
      },
    });
  },

  listForProgram(programId: string) {
    return prisma.programBatch.findMany({
      where: { programId, linkedFromBatchId: null },
      include: {
        program: { select: { id: true, title: true, status: true } },
        trainers: batchTrainersInclude,
        linkedBatches: {
          select: {
            id: true,
            programId: true,
            sortOrder: true,
            createdAt: true,
            program: { select: { id: true, title: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        _count: { select: { enrollments: { where: { status: ACTIVE_STATUS_FILTER } } } },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  create(
    data: {
      programId: string;
      name: string;
      description: string;
      capacity: number;
      startDate: Date | null;
      endDate: Date | null;
      createdByUserId: string;
      linkedFromBatchId?: string | null;
      sortOrder?: number;
    } & BatchTrackerFields,
  ) {
    return prisma.programBatch.create({ data, include: { trainers: batchTrainersInclude } });
  },

  update(
    id: string,
    data: {
      name?: string;
      description?: string;
      capacity?: number;
      startDate?: Date | null;
      endDate?: Date | null;
      sortOrder?: number;
    } & BatchTrackerFields,
  ) {
    return prisma.programBatch.update({ where: { id }, data, include: { trainers: batchTrainersInclude } });
  },

  async setTrainer(batchId: string, role: BatchTrainerRole, userId: string | null) {
    if (!userId) {
      await prisma.batchTrainer.deleteMany({ where: { batchId, role } });
      return;
    }
    const existing = await prisma.batchTrainer.findFirst({ where: { batchId, role } });
    if (existing) {
      await prisma.batchTrainer.update({ where: { id: existing.id }, data: { userId } });
      return;
    }
    await prisma.batchTrainer.create({ data: { batchId, role, userId } });
  },

  async replaceTrainers(batchId: string, trainers: Array<{ userId: string; role: BatchTrainerRole }>) {
    await prisma.$transaction([
      prisma.batchTrainer.deleteMany({ where: { batchId } }),
      ...(trainers.length > 0
        ? [prisma.batchTrainer.createMany({ data: trainers.map((row) => ({ batchId, userId: row.userId, role: row.role })) })]
        : []),
    ]);
  },

  async nextBatchNumber(month: number, year: number) {
    const top = await prisma.programBatch.aggregate({
      where: { month, year },
      _max: { batchNumber: true },
    });
    return (top._max.batchNumber ?? 0) + 1;
  },

  delete(id: string) {
    return prisma.programBatch.delete({ where: { id } });
  },

  countMembers(batchId: string) {
    return prisma.enrollment.count({
      where: { batchId, status: ACTIVE_STATUS_FILTER },
    });
  },
};
