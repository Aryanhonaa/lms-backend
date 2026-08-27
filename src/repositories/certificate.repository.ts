import { CertificateStatus } from "../generated/prisma";
import { prisma } from "../config/prisma";

const certificateInclude = {
  trainee: { select: { id: true, name: true } },
  trainer: { select: { id: true, name: true } },
  program: { select: { id: true, title: true } },
} as const;

export const certificateRepository = {
  findByEnrollment(enrollmentId: string) {
    return prisma.certificate.findUnique({
      where: { enrollmentId },
      include: certificateInclude,
    });
  },

  findByCertificateId(certificateId: string) {
    return prisma.certificate.findUnique({
      where: { certificateId },
      include: certificateInclude,
    });
  },

  listForTrainee(traineeUserId: string) {
    return prisma.certificate.findMany({
      where: { traineeUserId },
      include: certificateInclude,
      orderBy: { issuedAt: "desc" },
    });
  },

  listForPrograms(programIds: string[]) {
    if (programIds.length === 0) {
      return Promise.resolve([]);
    }
    return prisma.certificate.findMany({
      where: { programId: { in: programIds } },
      include: certificateInclude,
      orderBy: { issuedAt: "desc" },
    });
  },

  listAll() {
    return prisma.certificate.findMany({
      include: certificateInclude,
      orderBy: { issuedAt: "desc" },
    });
  },

  create(data: {
    certificateId: string;
    enrollmentId: string;
    traineeUserId: string;
    programId: string;
    trainerUserId: string;
    completionDate: Date;
    finalScore: number;
    verificationHash: string;
    documentKey?: string | null;
  }) {
    return prisma.certificate.create({
      data: {
        certificateId: data.certificateId,
        enrollmentId: data.enrollmentId,
        traineeUserId: data.traineeUserId,
        programId: data.programId,
        trainerUserId: data.trainerUserId,
        completionDate: data.completionDate,
        finalScore: data.finalScore,
        verificationHash: data.verificationHash,
        documentKey: data.documentKey ?? null,
      },
      include: certificateInclude,
    });
  },

  attachDocument(id: string, documentKey: string) {
    return prisma.certificate.update({
      where: { id },
      data: { documentKey },
      include: certificateInclude,
    });
  },

  revoke(id: string, revokedByUserId: string, reason: string) {
    return prisma.certificate.update({
      where: { id },
      data: {
        status: CertificateStatus.REVOKED,
        revokedAt: new Date(),
        revokedByUserId,
        revokeReason: reason,
      },
      include: certificateInclude,
    });
  },
};
