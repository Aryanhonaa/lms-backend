import { EnrollmentStatus, InterventionStatus, ProgramStatus, ResourceKind, Role } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { REVIEW_VISIBLE_PROGRAM_STATUSES } from "../repositories/program.repository";

export type MaterialType = "PROGRAM" | "VIDEO" | "DOCUMENT" | "LINK";

function startOfMonth(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function inferMaterialType(program: {
  weeks: Array<{
    days: Array<{
      videos: Array<{ id: string }>;
      resources: Array<{ kind: ResourceKind }>;
    }>;
  }>;
}): MaterialType {
  const days = program.weeks.flatMap((week) => week.days);
  if (days.some((day) => day.videos.length > 0)) {
    return "VIDEO";
  }

  const resources = days.flatMap((day) => day.resources);
  if (resources.some((resource) => resource.kind === ResourceKind.DOCUMENT)) {
    return "DOCUMENT";
  }
  if (resources.length > 0) {
    return "LINK";
  }

  return "PROGRAM";
}

function activityMessage(status: ProgramStatus, trainerName: string, title: string): string {
  switch (status) {
    case ProgramStatus.SUBMITTED:
      return `${trainerName} sent ${title} for review`;
    case ProgramStatus.APPROVED:
      return `${title} was approved`;
    case ProgramStatus.REJECTED:
      return `${title} was rejected`;
    case ProgramStatus.PUBLISHED:
      return `${title} was published`;
    default:
      return `${trainerName} updated ${title}`;
  }
}

export const adminDashboardService = {
  async getOverview() {
    const monthStart = startOfMonth();

    const [
      coursesTotal,
      coursesThisMonth,
      traineesTotal,
      traineesThisMonth,
      trainersTotal,
      pendingApprovalCount,
      pendingTrainerGroups,
      submittedPrograms,
      recentPrograms,
      recentUsers,
    ] = await Promise.all([
      prisma.program.count({ where: { status: { in: REVIEW_VISIBLE_PROGRAM_STATUSES } } }),
      prisma.program.count({
        where: { status: { in: REVIEW_VISIBLE_PROGRAM_STATUSES }, createdAt: { gte: monthStart } },
      }),
      prisma.user.count({ where: { role: Role.TRAINEE } }),
      prisma.user.count({ where: { role: Role.TRAINEE, createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { role: Role.TRAINER } }),
      prisma.program.count({ where: { status: ProgramStatus.SUBMITTED } }),
      prisma.program.groupBy({
        by: ["createdByUserId"],
        where: { status: ProgramStatus.SUBMITTED },
      }),
      prisma.program.findMany({
        where: { status: ProgramStatus.SUBMITTED },
        include: {
          createdBy: { select: { id: true, name: true } },
          weeks: {
            take: 2,
            select: {
              days: {
                take: 3,
                select: {
                  videos: { select: { id: true }, take: 1 },
                  resources: { select: { id: true, kind: true }, take: 3 },
                },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 6,
      }),
      prisma.program.findMany({
        where: { status: { in: REVIEW_VISIBLE_PROGRAM_STATUSES } },
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.user.findMany({
        where: { role: { in: [Role.TRAINER, Role.TRAINEE] } },
        select: { id: true, name: true, role: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

    const pendingApprovals = submittedPrograms.map((program) => ({
      id: program.id,
      title: program.title,
      course: program.category,
      trainerName: program.createdBy.name,
      type: inferMaterialType(program),
      uploadedAt: program.updatedAt.toISOString(),
    }));

    const programActivity = recentPrograms.map((program) => ({
      id: `program-${program.id}`,
      actorName: program.createdBy.name,
      message: activityMessage(program.status, program.createdBy.name, program.title),
      occurredAt: program.updatedAt.toISOString(),
    }));

    const userActivity = recentUsers.map((user) => ({
      id: `user-${user.id}`,
      actorName: user.name,
      message: `${user.name} joined as ${user.role === Role.TRAINER ? "a trainer" : "a trainee"}`,
      occurredAt: user.createdAt.toISOString(),
    }));

    const recentActivity = [...programActivity, ...userActivity]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 8);

    return {
      metrics: {
        courses: { total: coursesTotal, addedThisMonth: coursesThisMonth },
        trainees: { total: traineesTotal, addedThisMonth: traineesThisMonth },
        trainers: { total: trainersTotal, pending: pendingTrainerGroups.length },
        pendingApprovals: { total: pendingApprovalCount },
      },
      pendingApprovals,
      recentActivity,
    };
  },

  async getOperations() {
    const [
      totalPrograms,
      activePrograms,
      pendingApprovals,
      trainersTotal,
      traineesTotal,
      activeEnrollments,
      completedEnrollments,
      attentionFlags,
      submittedPrograms,
      recentEnrollments,
      recentPrograms,
      traineesWithActive,
      traineesLearning,
      traineesCompleted,
    ] = await Promise.all([
      prisma.program.count({ where: { status: { in: REVIEW_VISIBLE_PROGRAM_STATUSES } } }),
      prisma.program.count({
        where: { status: { in: [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED] } },
      }),
      prisma.program.count({ where: { status: ProgramStatus.SUBMITTED } }),
      prisma.user.count({ where: { role: Role.TRAINER } }),
      prisma.user.count({ where: { role: Role.TRAINEE } }),
      prisma.enrollment.count({ where: { status: EnrollmentStatus.ACTIVE } }),
      prisma.enrollment.count({ where: { status: EnrollmentStatus.COMPLETED } }),
      prisma.interventionFlag.findMany({
        where: { status: InterventionStatus.OPEN },
        select: { enrollment: { select: { userId: true } } },
      }),
      prisma.program.findMany({
        where: { status: ProgramStatus.SUBMITTED },
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.enrollment.findMany({
        where: { status: { not: EnrollmentStatus.WITHDRAWN } },
        include: {
          user: { select: { name: true } },
          program: { select: { title: true } },
          enrolledBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      prisma.program.findMany({
        where: { status: { in: [ProgramStatus.SUBMITTED, ProgramStatus.APPROVED, ProgramStatus.REJECTED] } },
        include: { createdBy: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.user.count({
        where: { role: Role.TRAINEE, enrollments: { some: { status: EnrollmentStatus.ACTIVE } } },
      }),
      prisma.user.count({
        where: {
          role: Role.TRAINEE,
          enrollments: {
            some: { status: EnrollmentStatus.ACTIVE, overallProgress: { gt: 0, lt: 100 } },
          },
        },
      }),
      prisma.user.count({
        where: { role: Role.TRAINEE, enrollments: { some: { status: EnrollmentStatus.COMPLETED } } },
      }),
    ]);

    const attentionUserIds = new Set(attentionFlags.map((row) => row.enrollment.userId));

    const pendingRows = submittedPrograms.map((program) => ({
      id: program.id,
      title: program.title,
      trainerName: program.createdBy.name,
      submittedAt: program.updatedAt.toISOString(),
      status: program.status,
    }));

    const programActivity = recentPrograms.map((program) => ({
      id: `program-${program.id}-${program.updatedAt.toISOString()}`,
      actorName: program.createdBy.name,
      message: activityMessage(program.status, program.createdBy.name, program.title),
      occurredAt: program.updatedAt.toISOString(),
    }));

    const enrollmentActivity = recentEnrollments.map((row) => ({
      id: `enrollment-${row.id}`,
      actorName: row.enrolledBy?.name ?? row.user.name,
      message: row.enrolledBy
        ? `${row.enrolledBy.name} enrolled ${row.user.name} in ${row.program.title}`
        : `${row.user.name} enrolled in ${row.program.title}`,
      occurredAt: row.createdAt.toISOString(),
    }));

    const recentActivity = [...programActivity, ...enrollmentActivity]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 10);

    return {
      metrics: {
        totalPrograms,
        activePrograms,
        pendingApprovals,
        trainers: trainersTotal,
        trainees: traineesTotal,
        activeEnrollments,
        completedPrograms: completedEnrollments,
        traineesRequiringAttention: attentionUserIds.size,
      },
      pendingApprovals: pendingRows,
      traineeOverview: {
        activeTrainees: traineesWithActive,
        currentlyLearning: traineesLearning,
        completedTrainees: traineesCompleted,
        requiringAttention: attentionUserIds.size,
      },
      recentActivity,
    };
  },
};
