import type { AssignmentStatus, AssignmentSubmissionStatus } from "../generated/prisma";
import { prisma } from "../config/prisma";

const assignmentScope = {
  day: { include: { week: { include: { program: true } } } },
} as const;

const submissionInclude = {
  assignment: { include: assignmentScope },
  enrollment: { include: { user: { select: { id: true, name: true, email: true } } } },
  gradedBy: { select: { id: true, name: true, email: true } },
  files: { orderBy: { createdAt: "asc" as const } },
} as const;

export const assignmentSubmissionRepository = {
  findAssignment(id: string) {
    return prisma.assignment.findUnique({
      where: { id },
      include: assignmentScope,
    });
  },

  findAssignmentsForProgram(programId: string) {
    return prisma.assignment.findMany({
      where: { day: { week: { programId } } },
      include: assignmentScope,
      orderBy: [{ day: { week: { sortOrder: "asc" } } }, { day: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    });
  },

  findAssignmentsForTrainer(programIds: string[]) {
    if (programIds.length === 0) {
      return Promise.resolve([]);
    }
    return prisma.assignment.findMany({
      where: { day: { week: { programId: { in: programIds } } } },
      include: {
        ...assignmentScope,
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  findSubmission(id: string) {
    return prisma.assignmentSubmission.findUnique({
      where: { id },
      include: submissionInclude,
    });
  },

  findAttempts(enrollmentId: string, assignmentId: string) {
    return prisma.assignmentSubmission.findMany({
      where: { enrollmentId, assignmentId },
      include: {
        gradedBy: { select: { id: true, name: true, email: true } },
        files: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { revision: "desc" },
    });
  },

  findForAssignment(assignmentId: string, batchId?: string) {
    return prisma.assignmentSubmission.findMany({
      where: {
        assignmentId,
        ...(batchId ? { enrollment: { batchId } } : {}),
      },
      include: {
        enrollment: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            batch: { select: { id: true, name: true } },
          },
        },
        gradedBy: { select: { id: true, name: true, email: true } },
        files: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ enrollmentId: "asc" }, { revision: "desc" }],
    });
  },

  async nextRevision(enrollmentId: string, assignmentId: string) {
    const latest = await prisma.assignmentSubmission.findFirst({
      where: { enrollmentId, assignmentId },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    return (latest?.revision ?? 0) + 1;
  },

  createDraft(input: {
    enrollmentId: string;
    assignmentId: string;
    body: string;
    revision: number;
    status: AssignmentSubmissionStatus;
    isLate: boolean;
    submittedAt: Date | null;
  }) {
    return prisma.assignmentSubmission.create({
      data: input,
      include: {
        gradedBy: { select: { id: true, name: true, email: true } },
        files: true,
      },
    });
  },

  updateAttempt(
    id: string,
    input: {
      body?: string;
      status?: AssignmentSubmissionStatus;
      isLate?: boolean;
      submittedAt?: Date | null;
    },
  ) {
    return prisma.assignmentSubmission.update({
      where: { id },
      data: input,
      include: {
        gradedBy: { select: { id: true, name: true, email: true } },
        files: { orderBy: { createdAt: "asc" } },
      },
    });
  },

  review(
    id: string,
    input: {
      status: AssignmentSubmissionStatus;
      score: number | null;
      trainerComment: string;
      gradedByUserId: string;
    },
  ) {
    return prisma.assignmentSubmission.update({
      where: { id },
      data: {
        status: input.status,
        score: input.score,
        trainerComment: input.trainerComment,
        gradedByUserId: input.gradedByUserId,
        gradedAt: new Date(),
      },
      include: submissionInclude,
    });
  },

  addFile(input: {
    submissionId: string;
    fileName: string;
    fileKey: string;
    mimeType: string;
    fileSize: number;
    storageProvider: string;
  }) {
    return prisma.assignmentSubmissionFile.create({ data: input });
  },

  findFile(id: string) {
    return prisma.assignmentSubmissionFile.findUnique({
      where: { id },
      include: {
        submission: {
          include: submissionInclude,
        },
      },
    });
  },

  deleteFile(id: string) {
    return prisma.assignmentSubmissionFile.delete({ where: { id } });
  },
};

export type AssignmentConfigInput = {
  title: string;
  description?: string;
  instructions?: string;
  dueDate?: string | Date | null;
  maxScore?: number;
  status?: AssignmentStatus;
  allowFileUpload?: boolean;
  allowTextResponse?: boolean;
  allowLateSubmission?: boolean;
  allowResubmission?: boolean;
  maxAttempts?: number;
  allowedFileTypes?: string;
  maxFileSizeMb?: number;
};
