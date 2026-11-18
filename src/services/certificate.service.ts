import { createHash, randomBytes } from "node:crypto";
import { CertificateStatus } from "../generated/prisma";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { certificateRenderer, type CertificateDocument } from "../certificates/certificate-renderer";
import { certificateRepository } from "../repositories/certificate.repository";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { enrollmentService } from "./enrollment.service";
import { programService } from "./program.service";
import { isExitedEnrollment } from "../utils/enrollment-status";
import {
  academicRequirementsMet,
  certificateEligibilityService,
  COURSE_REVIEW_REQUIREMENT_KEY,
  type CertificateEligibility,
} from "./certificate-eligibility.service";
import { fileStorage } from "../storage";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";

function createCertificateId(): string {
  return `LMS-${randomBytes(6).toString("hex").toUpperCase()}`;
}

function verificationHash(certificateId: string): string {
  return createHash("sha256").update(`${certificateId}.${env.jwtSecret}`).digest("hex");
}

function normalizeCertificateId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function verificationUrl(certificateId: string): string {
  const origin = env.publicUrl || env.corsOrigin;
  return `${origin.replace(/\/$/, "")}/verify?id=${encodeURIComponent(certificateId)}`;
}

export type PendingCourseReview = {
  enrollmentId: string;
  programId: string;
  programTitle: string;
  batchId: string;
  batchName: string;
};

function pendingReviewFrom(
  eligibility: CertificateEligibility,
  enrollment: { id: string; batchId: string; batch?: { name: string } | null },
  familyAcademicsReady: boolean,
): PendingCourseReview | null {
  const review = eligibility.requirements.find((row) => row.key === COURSE_REVIEW_REQUIREMENT_KEY);
  if (
    !familyAcademicsReady ||
    !review ||
    review.met ||
    !academicRequirementsMet(eligibility.requirements)
  ) {
    return null;
  }
  return {
    enrollmentId: enrollment.id,
    programId: eligibility.program.id,
    programTitle: eligibility.program.title,
    batchId: enrollment.batchId,
    batchName: enrollment.batch?.name ?? "",
  };
}

export function joinCourseTitles(titles: string[]): string {
  const unique = titles.map((title) => title.trim()).filter(Boolean).filter((title, index, list) => list.indexOf(title) === index);
  if (unique.length <= 1) {
    return unique[0] ?? "";
  }
  if (unique.length === 2) {
    return `${unique[0]} and ${unique[1]}`;
  }
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function titlesFor(row: { courseTitles?: string[]; program: { title: string } }) {
  return row.courseTitles && row.courseTitles.length > 0 ? row.courseTitles : [row.program.title];
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function toPublic(row: {
  certificateId: string;
  trainee: { name: string };
  program: { title: string };
  trainer: { name: string };
  completionDate: Date;
  status: CertificateStatus;
  courseTitles?: string[];
}) {
  return {
    certificateId: row.certificateId,
    traineeName: row.trainee.name,
    program: joinCourseTitles(titlesFor(row)),
    trainer: row.trainer.name,
    completionDate: row.completionDate.toISOString(),
    status: row.status,
  };
}

function toOwned(
  row: NonNullable<Awaited<ReturnType<typeof certificateRepository.findByCertificateId>>>,
) {
  const courseTitles = titlesFor(row);
  return {
    certificateId: row.certificateId,
    program: { id: row.program.id, title: joinCourseTitles(courseTitles) },
    courseTitles,
    trainerName: row.trainer.name,
    traineeName: row.trainee.name,
    completionDate: row.completionDate.toISOString(),
    issuedAt: row.issuedAt.toISOString(),
    status: row.status,
    verificationUrl: verificationUrl(row.certificateId),
  };
}

function toDocument(
  row: NonNullable<Awaited<ReturnType<typeof certificateRepository.findByCertificateId>>>,
  finalScore: number,
): CertificateDocument {
  return {
    certificateId: row.certificateId,
    traineeName: row.trainee.name,
    programTitle: joinCourseTitles(titlesFor(row)),
    trainerName: row.trainer.name,
    completionDate: row.completionDate.toISOString(),
    issuedAt: row.issuedAt.toISOString(),
    finalScore,
    status: row.status,
  };
}

type AssignmentFamily = {
  assignedEnrollmentIds: string[];
  primaryEnrollmentId: string | null;
  courseTitles: string[];
  missingAssigned: boolean;
};

async function familyAcademicsReady(family: AssignmentFamily): Promise<boolean> {
  if (family.missingAssigned || !family.primaryEnrollmentId) {
    return false;
  }
  const evaluations = await Promise.all(
    family.assignedEnrollmentIds.map((id) => certificateEligibilityService.evaluate(id)),
  );
  return evaluations.every((row) => academicRequirementsMet(row.requirements));
}

async function loadAssignmentFamily(enrollmentId: string): Promise<AssignmentFamily> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      userId: true,
      batch: { select: { id: true, linkedFromBatchId: true } },
    },
  });
  if (!enrollment) {
    throw ApiError.notFound("Enrollment not found");
  }

  const primaryBatchId = enrollment.batch.linkedFromBatchId ?? enrollment.batch.id;
  const primaryBatch = await prisma.programBatch.findUniqueOrThrow({
    where: { id: primaryBatchId },
    select: {
      id: true,
      program: { select: { title: true } },
      linkedBatches: {
        select: { id: true, program: { select: { title: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const familyBatchIds = [primaryBatch.id, ...primaryBatch.linkedBatches.map((row) => row.id)];
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: enrollment.userId, batchId: { in: familyBatchIds } },
    select: { id: true, batchId: true, status: true },
  });
  const byBatch = new Map(enrollments.map((row) => [row.batchId, row]));
  const assigned = familyBatchIds
    .map((batchId) => byBatch.get(batchId))
    .filter((row): row is NonNullable<typeof row> => row != null && !isExitedEnrollment(row.status));
  const primary = assigned.find((row) => row.batchId === primaryBatch.id) ?? assigned[0] ?? null;

  return {
    assignedEnrollmentIds: assigned.map((row) => row.id),
    primaryEnrollmentId: primary?.id ?? null,
    courseTitles: [primaryBatch.program.title, ...primaryBatch.linkedBatches.map((row) => row.program.title)],
    missingAssigned: familyBatchIds.some((batchId) => !byBatch.has(batchId)),
  };
}

async function renderDocument(
  row: NonNullable<Awaited<ReturnType<typeof certificateRepository.create>>>,
  finalScore: number,
) {
  const rendered = await certificateRenderer.render(toDocument(row, finalScore));
  if (rendered.kind !== "pdf") {
    return row;
  }
  const stored = await fileStorage.save(
    {
      buffer: rendered.bytes,
      originalName: rendered.fileName,
      mimeType: "application/pdf",
      size: rendered.bytes.length,
      folder: "certificates",
    },
    env.corsOrigin,
  );
  return certificateRepository.attachDocument(row.id, stored.key);
}

export const certificateService = {
  async issueIfEligible(enrollmentId: string) {
    const family = await loadAssignmentFamily(enrollmentId);
    const existing = await certificateRepository.findByEnrollments(family.assignedEnrollmentIds);
    if (existing) {
      return existing;
    }
    if (family.missingAssigned || !family.primaryEnrollmentId) {
      return null;
    }

    const evaluations = await Promise.all(
      family.assignedEnrollmentIds.map((id) => certificateEligibilityService.evaluate(id)),
    );
    if (evaluations.some((row) => !row.eligible)) {
      return null;
    }

    const primaryEligibility =
      evaluations.find((row) => row.enrollmentId === family.primaryEnrollmentId) ?? evaluations[0];
    const finalScore = roundScore(
      evaluations.reduce((sum, row) => sum + row.finalScore, 0) / evaluations.length,
    );
    const issuedAt = new Date();
    let created = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const certificateId = createCertificateId();
      try {
        created = await certificateRepository.create({
          certificateId,
          enrollmentId: family.primaryEnrollmentId,
          traineeUserId: primaryEligibility.trainee.id,
          programId: primaryEligibility.program.id,
          trainerUserId: primaryEligibility.trainer.id,
          completionDate: issuedAt,
          finalScore,
          courseTitles: family.courseTitles,
          verificationHash: verificationHash(certificateId),
        });
        break;
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (code !== "P2002") {
          throw error;
        }
        const raced = await certificateRepository.findByEnrollments(family.assignedEnrollmentIds);
        if (raced) {
          return raced;
        }
      }
    }
    if (!created) {
      return certificateRepository.findByEnrollments(family.assignedEnrollmentIds);
    }
    return renderDocument(created, finalScore);
  },

  async listForTrainee(user: AuthUser) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    await enrollmentService.ensureVisibleEnrollments(user.id);
    const enrollments = await enrollmentRepository.findByUser(user.id);
    const pendingReviews: PendingCourseReview[] = [];
    for (const enrollment of enrollments) {
      if (isExitedEnrollment(enrollment.status)) {
        continue;
      }
      const issued = await this.issueIfEligible(enrollment.id);
      if (issued) {
        continue;
      }
      const family = await loadAssignmentFamily(enrollment.id);
      const eligibility = await certificateEligibilityService.evaluate(enrollment.id);
      const pending = pendingReviewFrom(eligibility, enrollment, await familyAcademicsReady(family));
      if (pending) {
        pendingReviews.push(pending);
      }
    }
    const rows = await certificateRepository.listForTrainee(user.id);
    const { familyFullyPassed } = await import("./batch-family.service");
    const certificates = [];
    for (const row of rows) {
      const enrollment = await prisma.enrollment.findUnique({
        where: { id: row.enrollmentId },
        select: { batchId: true },
      });
      if (!enrollment || !(await familyFullyPassed(user.id, enrollment.batchId))) {
        continue;
      }
      certificates.push(toOwned(row));
    }
    return { certificates, pendingReviews };
  },

  async getForTrainee(user: AuthUser, certificateId: string) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    const row = await certificateRepository.findByCertificateId(normalizeCertificateId(certificateId));
    if (!row || row.traineeUserId !== user.id) {
      throw ApiError.notFound("Certificate not found");
    }
    return { certificate: toOwned(row) };
  },

  async statusForProgram(user: AuthUser, programId: string, batchId?: string) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    const { enrollment } = await (await import("./progress.service")).progressService.requireEnrollment(
      user.id,
      programId,
      batchId,
    );
    await this.issueIfEligible(enrollment.id);
    const family = await loadAssignmentFamily(enrollment.id);
    const eligibility = await certificateEligibilityService.evaluate(enrollment.id);
    const row = await certificateRepository.findByEnrollments(family.assignedEnrollmentIds);
    const evaluations = await Promise.all(
      family.assignedEnrollmentIds.map((id) => certificateEligibilityService.evaluate(id)),
    );
    const academicsReady =
      !family.missingAssigned &&
      Boolean(family.primaryEnrollmentId) &&
      evaluations.every((item) => academicRequirementsMet(item.requirements));
    const familyEligible = academicsReady && evaluations.every((item) => item.eligible);
    return {
      eligible: familyEligible,
      requirements: eligibility.requirements,
      pendingReview: Boolean(pendingReviewFrom(eligibility, enrollment, academicsReady)),
      certificate: row ? toOwned(row) : null,
    };
  },

  async listForTrainer(user: AuthUser) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    const programs = await programService.listForTrainer(user.id);
    const rows = await certificateRepository.listForPrograms(programs.map((row) => row.id));
    return { certificates: rows.map(toOwned) };
  },

  async listForAdmin(user: AuthUser) {
    if (user.role !== "SUPER_ADMIN") {
      throw ApiError.forbidden();
    }
    const rows = await certificateRepository.listAll();
    return { certificates: rows.map(toOwned) };
  },

  async revoke(user: AuthUser, certificateId: string, reason?: string) {
    if (user.role !== "SUPER_ADMIN") {
      throw ApiError.forbidden();
    }
    const row = await certificateRepository.findByCertificateId(normalizeCertificateId(certificateId));
    if (!row) {
      throw ApiError.notFound("Certificate not found");
    }
    if (row.status === CertificateStatus.REVOKED) {
      return { certificate: toOwned(row) };
    }
    const saved = await certificateRepository.revoke(row.id, user.id, reason?.trim() ?? "");
    return { certificate: toOwned(saved) };
  },

  async verifyPublic(certificateId: string) {
    const row = await certificateRepository.findByCertificateId(normalizeCertificateId(certificateId));
    if (!row) {
      throw ApiError.notFound("Certificate not found");
    }
    return { certificate: toPublic(row) };
  },
};
