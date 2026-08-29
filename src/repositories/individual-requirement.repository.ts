import { IndividualRequirementStatus, type Prisma } from "../generated/prisma";
import { prisma } from "../config/prisma";

const requirementInclude = {
  enrollment: {
    include: {
      user: { select: { id: true, name: true, email: true } },
      program: { select: { id: true, title: true } },
      batch: { select: { id: true, name: true } },
    },
  },
  assignedBy: { select: { id: true, name: true, email: true } },
  interventionFlag: {
    select: { id: true, trigger: true, status: true },
  },
} as const;

export const individualRequirementRepository = {
  findById(id: string) {
    return prisma.individualRequirement.findUnique({
      where: { id },
      include: requirementInclude,
    });
  },

  listForEnrollments(enrollmentIds: string[]) {
    if (enrollmentIds.length === 0) {
      return Promise.resolve([]);
    }

    return prisma.individualRequirement.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      include: requirementInclude,
      orderBy: [{ status: "asc" }, { deadline: "asc" }, { createdAt: "desc" }],
    });
  },

  listForEnrollment(enrollmentId: string) {
    return this.listForEnrollments([enrollmentId]);
  },

  create(data: {
    enrollmentId: string;
    assignedByUserId: string;
    interventionFlagId?: string | null;
    type: Prisma.IndividualRequirementCreateInput["type"];
    title: string;
    description: string;
    trainerMessage: string;
    reason: string;
    deadline: Date | null;
  }) {
    return prisma.individualRequirement.create({
      data: {
        enrollmentId: data.enrollmentId,
        assignedByUserId: data.assignedByUserId,
        interventionFlagId: data.interventionFlagId ?? null,
        type: data.type,
        title: data.title,
        description: data.description,
        trainerMessage: data.trainerMessage,
        reason: data.reason,
        deadline: data.deadline,
      },
      include: requirementInclude,
    });
  },

  update(id: string, data: Prisma.IndividualRequirementUpdateInput) {
    return prisma.individualRequirement.update({
      where: { id },
      data,
      include: requirementInclude,
    });
  },

  markOverdue(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve({ count: 0 });
    }

    return prisma.individualRequirement.updateMany({
      where: {
        id: { in: ids },
        status: { in: [IndividualRequirementStatus.PENDING, IndividualRequirementStatus.IN_PROGRESS] },
      },
      data: { status: IndividualRequirementStatus.OVERDUE },
    });
  },
};
