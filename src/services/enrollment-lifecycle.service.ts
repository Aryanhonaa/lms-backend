import { CertificateStatus, CourseOutcome, EnrollmentStatus } from "../generated/prisma";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { batchService } from "./batch.service";
import { enrollmentActivity, enrollmentActivityCount } from "./enrollment-activity";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isExitedEnrollment } from "../utils/enrollment-status";
import { civilNoonInZone, zonedYmd } from "../utils/timezone";

export type ExitType = "LEFT" | "TERMINATED";

function civilDate(value: string | undefined, label: string): Date {
  if (!value) {
    return new Date();
  }
  const date = civilNoonInZone(value, env.timezone);
  if (!date) {
    throw ApiError.badRequest(`Invalid ${label}`);
  }
  return date;
}

function assertNotFuture(date: Date, label: string) {
  if (zonedYmd(date, env.timezone) > zonedYmd(new Date(), env.timezone)) {
    throw ApiError.badRequest(`${label} cannot be in the future.`);
  }
}

async function requireEnrollmentAccess(user: AuthUser, enrollmentId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { certificate: { select: { status: true } } },
  });
  if (!enrollment) {
    throw ApiError.notFound("Enrollment not found");
  }
  await batchService.requireBatchManage(user, enrollment.batchId);
  return enrollment;
}

function isCertified(row: { courseOutcome: CourseOutcome; certificate: { status: CertificateStatus } | null }) {
  if (row.certificate) {
    return row.certificate.status === CertificateStatus.VALID;
  }
  return row.courseOutcome === CourseOutcome.PASSED;
}

export const enrollmentLifecycleService = {
  async exit(user: AuthUser, enrollmentId: string, input: { type: ExitType; date?: string; reason?: string }) {
    const enrollment = await requireEnrollmentAccess(user, enrollmentId);
    if (isExitedEnrollment(enrollment.status)) {
      throw ApiError.conflict("This trainee has already exited the batch.");
    }
    const exitedAt = civilDate(input.date, "exit date");
    assertNotFuture(exitedAt, "Exit date");
    if (zonedYmd(exitedAt, env.timezone) < zonedYmd(enrollment.joinedAt, env.timezone)) {
      throw ApiError.badRequest("Exit date cannot be before the joining date.");
    }
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: input.type === "TERMINATED" ? EnrollmentStatus.TERMINATED : EnrollmentStatus.WITHDRAWN,
        exitedAt,
        exitReason: input.reason?.trim() ?? "",
        exitedByUserId: user.id,
        handedOverAt: null,
        teamId: null,
      },
    });
    return { updated: true };
  },

  async remove(user: AuthUser, enrollmentId: string, input: { reason?: string }) {
    const enrollment = await requireEnrollmentAccess(user, enrollmentId);
    if (enrollment.status === EnrollmentStatus.REMOVED) {
      throw ApiError.conflict("This enrollment has already been removed.");
    }
    if (isExitedEnrollment(enrollment.status)) {
      throw ApiError.conflict("This trainee has already exited the batch. Reinstate them first if needed.");
    }
    const counts = await prisma.enrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
      select: { _count: enrollmentActivityCount },
    });
    const activity = enrollmentActivity(counts._count, Boolean(enrollment.certificate));
    if (activity.length > 0) {
      throw ApiError.conflict(
        `This trainee has already started the course (${activity.join(", ")}). Use "Mark as left" instead.`,
      );
    }
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: EnrollmentStatus.REMOVED,
        exitedAt: new Date(),
        exitReason: input.reason?.trim() || "Enrolled by mistake",
        exitedByUserId: user.id,
        handedOverAt: null,
        teamId: null,
      },
    });
    return { removed: true };
  },

  async reinstate(user: AuthUser, enrollmentId: string) {
    const enrollment = await requireEnrollmentAccess(user, enrollmentId);
    if (enrollment.status === EnrollmentStatus.REMOVED) {
      throw ApiError.badRequest("This enrollment was removed. Enroll the trainee again instead.");
    }
    if (!isExitedEnrollment(enrollment.status)) {
      return { updated: false };
    }
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: enrollment.courseOutcome === CourseOutcome.PASSED ? EnrollmentStatus.COMPLETED : EnrollmentStatus.ACTIVE,
        exitedAt: null,
        exitReason: "",
        exitedByUserId: null,
      },
    });
    const { progressService } = await import("./progress.service");
    await progressService.recomputeEnrollment(enrollment.id);
    return { updated: true };
  },

  async setJoinedDate(user: AuthUser, enrollmentId: string, date: string) {
    const enrollment = await requireEnrollmentAccess(user, enrollmentId);
    const joinedAt = civilDate(date, "joining date");
    assertNotFuture(joinedAt, "Joining date");
    if (enrollment.exitedAt && zonedYmd(joinedAt, env.timezone) > zonedYmd(enrollment.exitedAt, env.timezone)) {
      throw ApiError.badRequest("Joining date cannot be after the exit date.");
    }
    await prisma.enrollment.update({ where: { id: enrollment.id }, data: { joinedAt } });
    return { updated: true };
  },

  async handover(
    user: AuthUser,
    batchId: string,
    input: { enrollmentIds: string[]; teamId: string; date?: string },
  ) {
    await batchService.requireBatchManage(user, batchId);
    const team = await prisma.team.findUnique({ where: { id: input.teamId } });
    if (!team || !team.isActive) {
      throw ApiError.badRequest("Choose an active team.");
    }
    const handedOverAt = civilDate(input.date, "handover date");
    assertNotFuture(handedOverAt, "Handover date");

    const rows = await prisma.enrollment.findMany({
      where: { id: { in: input.enrollmentIds }, batchId },
      include: { certificate: { select: { status: true } } },
    });
    const eligible = rows.filter((row) => !isExitedEnrollment(row.status) && isCertified(row));
    if (eligible.length === 0) {
      throw ApiError.badRequest("Only certified trainees can be handed over.");
    }
    await prisma.enrollment.updateMany({
      where: { id: { in: eligible.map((row) => row.id) } },
      data: { handedOverAt, teamId: team.id },
    });
    return {
      handedOver: eligible.length,
      skipped: input.enrollmentIds.length - eligible.length,
    };
  },

  async undoHandover(user: AuthUser, enrollmentId: string) {
    const enrollment = await requireEnrollmentAccess(user, enrollmentId);
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { handedOverAt: null, teamId: null },
    });
    return { updated: true };
  },
};
