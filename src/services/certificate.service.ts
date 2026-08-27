import { createHash, randomBytes } from "node:crypto";
import { CertificateStatus, EnrollmentStatus } from "../generated/prisma";
import { env } from "../config/env";
import { certificateRenderer, type CertificateDocument } from "../certificates/certificate-renderer";
import { certificateRepository } from "../repositories/certificate.repository";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { enrollmentService } from "./enrollment.service";
import { programService } from "./program.service";
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
): PendingCourseReview | null {
  const review = eligibility.requirements.find((row) => row.key === COURSE_REVIEW_REQUIREMENT_KEY);
  if (!review || review.met || !academicRequirementsMet(eligibility.requirements)) {
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

function toPublic(row: {
  certificateId: string;
  trainee: { name: string };
  program: { title: string };
  trainer: { name: string };
  completionDate: Date;
  status: CertificateStatus;
}) {
  return {
    certificateId: row.certificateId,
    traineeName: row.trainee.name,
    program: row.program.title,
    trainer: row.trainer.name,
    completionDate: row.completionDate.toISOString(),
    status: row.status,
  };
}

function toOwned(
  row: NonNullable<Awaited<ReturnType<typeof certificateRepository.findByCertificateId>>>,
) {
  return {
    certificateId: row.certificateId,
    program: { id: row.program.id, title: row.program.title },
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
    programTitle: row.program.title,
    trainerName: row.trainer.name,
    completionDate: row.completionDate.toISOString(),
    issuedAt: row.issuedAt.toISOString(),
    finalScore,
    status: row.status,
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
    const existing = await certificateRepository.findByEnrollment(enrollmentId);
    if (existing) {
      return existing;
    }

    const eligibility = await certificateEligibilityService.evaluate(enrollmentId);
    if (!eligibility.eligible) {
      return null;
    }

    const issuedAt = new Date();
    let created = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const certificateId = createCertificateId();
      try {
        created = await certificateRepository.create({
          certificateId,
          enrollmentId,
          traineeUserId: eligibility.trainee.id,
          programId: eligibility.program.id,
          trainerUserId: eligibility.trainer.id,
          completionDate: issuedAt,
          finalScore: eligibility.finalScore,
          verificationHash: verificationHash(certificateId),
        });
        break;
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (code !== "P2002") {
          throw error;
        }
        const raced = await certificateRepository.findByEnrollment(enrollmentId);
        if (raced) {
          return raced;
        }
      }
    }
    if (!created) {
      return certificateRepository.findByEnrollment(enrollmentId);
    }
    return renderDocument(created, eligibility.finalScore);
  },

  async listForTrainee(user: AuthUser) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    await enrollmentService.ensureVisibleEnrollments(user.id);
    const enrollments = await enrollmentRepository.findByUser(user.id);
    const pendingReviews: PendingCourseReview[] = [];
    for (const enrollment of enrollments) {
      if (enrollment.status === EnrollmentStatus.WITHDRAWN) {
        continue;
      }
      const issued = await this.issueIfEligible(enrollment.id);
      if (issued) {
        continue;
      }
      const eligibility = await certificateEligibilityService.evaluate(enrollment.id);
      const pending = pendingReviewFrom(eligibility, enrollment);
      if (pending) {
        pendingReviews.push(pending);
      }
    }
    const rows = await certificateRepository.listForTrainee(user.id);
    return { certificates: rows.map(toOwned), pendingReviews };
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
    const eligibility = await certificateEligibilityService.evaluate(enrollment.id);
    const row = await certificateRepository.findByEnrollment(enrollment.id);
    return {
      eligible: eligibility.eligible,
      requirements: eligibility.requirements,
      pendingReview: Boolean(pendingReviewFrom(eligibility, enrollment)),
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
