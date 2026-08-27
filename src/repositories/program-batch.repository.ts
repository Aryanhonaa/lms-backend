import { EnrollmentStatus } from "../generated/prisma";
import { prisma } from "../config/prisma";

export const programBatchRepository = {
  findById(id: string) {
    return prisma.programBatch.findUnique({
      where: { id },
      include: {
        program: { select: { id: true, title: true, status: true } },
        _count: { select: { enrollments: { where: { status: { not: EnrollmentStatus.WITHDRAWN } } } } },
      },
    });
  },

  listForProgram(programId: string) {
    return prisma.programBatch.findMany({
      where: { programId },
      include: {
        _count: { select: { enrollments: { where: { status: { not: EnrollmentStatus.WITHDRAWN } } } } },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  create(data: {
    programId: string;
    name: string;
    description: string;
    capacity: number;
    startDate: Date | null;
    endDate: Date | null;
    createdByUserId: string;
  }) {
    return prisma.programBatch.create({ data });
  },

  update(
    id: string,
    data: {
      name?: string;
      description?: string;
      capacity?: number;
      startDate?: Date | null;
      endDate?: Date | null;
    },
  ) {
    return prisma.programBatch.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.programBatch.delete({ where: { id } });
  },

  countMembers(batchId: string) {
    return prisma.enrollment.count({
      where: { batchId, status: { not: EnrollmentStatus.WITHDRAWN } },
    });
  },
};
