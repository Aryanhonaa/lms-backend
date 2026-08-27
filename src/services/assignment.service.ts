import { AssignmentStatus, AssignmentSubmissionStatus } from "../generated/prisma";
import { env } from "../config/env";
import { assignmentSubmissionRepository } from "../repositories/assignment-submission.repository";
import { contentAttachmentRepository } from "../repositories/content-attachment.repository";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { fileStorage } from "../storage";
import { deleteStorageObjectIfUnreferenced, publicAttachment } from "./file.service";
import { programService } from "./program.service";
import { progressService } from "./progress.service";
import { resolveTrainerWorkScope } from "./trainer-scope";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { assertSafeUpload, safeDownloadName } from "../utils/submission-files";

type AssignmentRecord = NonNullable<Awaited<ReturnType<typeof assignmentSubmissionRepository.findAssignment>>>;
type AttemptRecord = {
  id: string;
  status: AssignmentSubmissionStatus;
  body: string;
  revision: number;
  isLate: boolean;
  submittedAt: Date | null;
  score: number | null;
  trainerComment: string;
  gradedBy: { id: string; name: string; email: string } | null;
  gradedAt: Date | null;
  updatedAt: Date;
  files: Array<{ id: string; fileName: string; mimeType: string; fileSize: number; createdAt: Date }>;
};

const REVIEWABLE: AssignmentSubmissionStatus[] = [
  AssignmentSubmissionStatus.SUBMITTED,
  AssignmentSubmissionStatus.GRADED,
  AssignmentSubmissionStatus.CHANGES_REQUESTED,
];
const CLOSED_ATTEMPT: AssignmentSubmissionStatus[] = [
  AssignmentSubmissionStatus.SUBMITTED,
  AssignmentSubmissionStatus.GRADED,
  AssignmentSubmissionStatus.CHANGES_REQUESTED,
  AssignmentSubmissionStatus.COMPLETED,
];
const EDITABLE: AssignmentSubmissionStatus[] = [AssignmentSubmissionStatus.IN_PROGRESS];

function programIdFromAssignment(assignment: AssignmentRecord): string {
  return assignment.day.week.programId;
}

function virtualStatus(submission: { status: AssignmentSubmissionStatus } | null) {
  return submission?.status ?? "NOT_STARTED";
}

function isPastDue(assignment: AssignmentRecord, now = new Date()): boolean {
  return Boolean(assignment.dueDate && assignment.dueDate.getTime() < now.getTime());
}

function toFilePayload(file: { id: string; fileName: string; mimeType: string; fileSize: number; createdAt: Date }) {
  return {
    id: file.id,
    fileName: file.fileName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    createdAt: file.createdAt,
  };
}

function toAttemptPayload(assignment: AssignmentRecord, submission: AttemptRecord) {
  return {
    id: submission.id,
    status: submission.status,
    body: submission.body,
    revision: submission.revision,
    isLate: submission.isLate,
    submittedAt: submission.submittedAt,
    score: submission.score,
    trainerComment: submission.trainerComment,
    gradedBy: submission.gradedBy,
    gradedAt: submission.gradedAt,
    updatedAt: submission.updatedAt,
    maxScore: assignment.maxScore,
    files: submission.files.map(toFilePayload),
  };
}

function closedAttemptCount(attempts: AttemptRecord[]): number {
  return attempts.filter((row) => CLOSED_ATTEMPT.includes(row.status)).length;
}

function currentAttempt(attempts: AttemptRecord[]): AttemptRecord | null {
  return attempts[0] ?? null;
}

function canStartOrEdit(
  assignment: AssignmentRecord,
  attempts: AttemptRecord[],
  accessLocked: boolean,
): { ok: boolean; message?: string } {
  if (accessLocked) {
    return { ok: false, message: "This assignment is locked." };
  }
  if (assignment.status === AssignmentStatus.DRAFT) {
    return { ok: false, message: "This assignment is not published yet." };
  }
  if (assignment.status === AssignmentStatus.CLOSED) {
    return { ok: false, message: "This assignment is no longer accepting submissions." };
  }

  const current = currentAttempt(attempts);
  if (current && EDITABLE.includes(current.status)) {
    if (isPastDue(assignment) && !assignment.allowLateSubmission) {
      return { ok: false, message: "Late submissions are not allowed." };
    }
    return { ok: true };
  }

  if (isPastDue(assignment) && !assignment.allowLateSubmission) {
    return { ok: false, message: "Late submissions are not allowed." };
  }

  const used = closedAttemptCount(attempts);
  if (current?.status === AssignmentSubmissionStatus.SUBMITTED) {
    return { ok: false, message: "This assignment is waiting for trainer review." };
  }
  if (current?.status === AssignmentSubmissionStatus.CHANGES_REQUESTED) {
    return { ok: true };
  }
  if (
    current?.status === AssignmentSubmissionStatus.GRADED ||
    current?.status === AssignmentSubmissionStatus.COMPLETED
  ) {
    if (!assignment.allowResubmission) {
      return { ok: false, message: "Resubmission is not enabled for this assignment." };
    }
    if (used >= assignment.maxAttempts) {
      return { ok: false, message: "Your maximum number of attempts has been reached." };
    }
    return { ok: true };
  }
  if (!current) {
    return { ok: true };
  }
  return { ok: false, message: "This assignment is waiting for trainer review." };
}

function validateSubmitContent(assignment: AssignmentRecord, body: string, fileCount: number): void {
  const hasText = body.trim().length > 0;
  const hasFiles = fileCount > 0;
  if (assignment.allowTextResponse && !assignment.allowFileUpload && !hasText) {
    throw ApiError.badRequest("Please provide a response before submitting.");
  }
  if (assignment.allowFileUpload && !assignment.allowTextResponse && !hasFiles) {
    throw ApiError.badRequest("Please upload at least one file before submitting.");
  }
  if (assignment.allowTextResponse && assignment.allowFileUpload && !hasText && !hasFiles) {
    throw ApiError.badRequest("Please provide a response or upload a file before submitting.");
  }
}

async function catalogForAssignment(user: AuthUser, assignment: AssignmentRecord, batchId?: string) {
  if (assignment.status === AssignmentStatus.DRAFT) {
    throw ApiError.notFound("Assignment not found");
  }

  const programId = programIdFromAssignment(assignment);
  let view;
  try {
    view = await progressService.getComputation(user, programId, batchId);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      throw ApiError.forbidden("You are not enrolled in this program.");
    }
    throw error;
  }
  const access = progressService.assignmentAccess(view, assignment.id);
  const attachments =
    access.status === "LOCKED" ? [] : await contentAttachmentRepository.listForAssignment(assignment.id);
  const attempts = await assignmentSubmissionRepository.findAttempts(view.enrollment.id, assignment.id);
  const current = currentAttempt(attempts);
  const status = virtualStatus(current);
  const eligibility = canStartOrEdit(assignment, attempts, access.status === "LOCKED");

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      instructions: assignment.instructions,
      dueDate: assignment.dueDate,
      maxScore: assignment.maxScore,
      status: access.status,
      lifecycleStatus: assignment.status,
      reason: access.reason,
      programId,
      programTitle: view.program.title,
      location: `${assignment.day.week.title} · ${assignment.day.title}`,
      allowFileUpload: assignment.allowFileUpload,
      allowTextResponse: assignment.allowTextResponse,
      allowLateSubmission: assignment.allowLateSubmission,
      allowResubmission: assignment.allowResubmission,
      maxAttempts: assignment.maxAttempts,
      allowedFileTypes: assignment.allowedFileTypes,
      maxFileSizeMb: assignment.maxFileSizeMb,
      attemptCount: closedAttemptCount(attempts),
      pastDue: isPastDue(assignment),
      attachments: attachments.map(publicAttachment),
    },
    submission: current
      ? toAttemptPayload(assignment, current)
      : {
          id: null,
          status,
          body: "",
          revision: 0,
          isLate: false,
          submittedAt: null,
          score: null,
          trainerComment: "",
          gradedBy: null,
          gradedAt: null,
          updatedAt: null,
          maxScore: assignment.maxScore,
          files: [],
        },
    attempts: attempts.map((row) => toAttemptPayload(assignment, row)),
    canSubmit: eligibility.ok,
    submitBlockReason: eligibility.ok ? null : (eligibility.message ?? null),
  };
}

export const assignmentService = {
  async listForTrainee(user: AuthUser) {
    const enrollments = await progressService.listSummaries(user.id);
    const assignments = [];
    for (const enrollment of enrollments) {
      const rows = await assignmentSubmissionRepository.findAssignmentsForProgram(enrollment.program.id);
      for (const assignment of rows) {
        if (assignment.status === AssignmentStatus.DRAFT) {
          continue;
        }
        assignments.push(await catalogForAssignment(user, assignment, enrollment.batch?.id));
      }
    }
    return { assignments };
  },

  async getForTrainee(user: AuthUser, assignmentId: string, batchId?: string) {
    const assignment = await assignmentSubmissionRepository.findAssignment(assignmentId);
    if (!assignment) {
      throw ApiError.notFound("Assignment not found");
    }
    return catalogForAssignment(user, assignment, batchId);
  },

  async submit(user: AuthUser, assignmentId: string, input: { body?: string; submit?: boolean; batchId?: string }) {
    const assignment = await assignmentSubmissionRepository.findAssignment(assignmentId);
    if (!assignment) {
      throw ApiError.notFound("Assignment not found");
    }

    const batchId = input.batchId;
    const catalog = await catalogForAssignment(user, assignment, batchId);
    if (catalog.assignment.status === "LOCKED") {
      throw new ApiError(403, catalog.assignment.reason ?? "This assignment is locked", "CONTENT_LOCKED");
    }

    const view = await progressService.getComputation(user, programIdFromAssignment(assignment), batchId);
    const attempts = await assignmentSubmissionRepository.findAttempts(view.enrollment.id, assignment.id);
    const eligibility = canStartOrEdit(assignment, attempts, false);
    if (!eligibility.ok) {
      const message = eligibility.message ?? "Unable to submit the assignment.";
      if (message.includes("waiting for trainer review") || message.includes("maximum number of attempts")) {
        throw ApiError.conflict(message);
      }
      if (message.includes("Late submissions") || message.includes("no longer accepting") || message.includes("not published")) {
        throw ApiError.badRequest(message);
      }
      throw ApiError.forbidden(message);
    }

    const submitting = input.submit === true;
    const body = input.body ?? catalog.submission.body;
    const current = currentAttempt(attempts);
    const late = isPastDue(assignment);
    let saved: AttemptRecord;

    if (current && EDITABLE.includes(current.status)) {
      if (submitting) {
        validateSubmitContent(assignment, body, current.files.length);
      }
      saved = await assignmentSubmissionRepository.updateAttempt(current.id, {
        body,
        status: submitting ? AssignmentSubmissionStatus.SUBMITTED : AssignmentSubmissionStatus.IN_PROGRESS,
        isLate: submitting ? late : current.isLate,
        submittedAt: submitting ? new Date() : current.submittedAt,
      });
    } else {
      if (submitting) {
        validateSubmitContent(assignment, body, 0);
      }
      saved = await assignmentSubmissionRepository.createDraft({
        enrollmentId: view.enrollment.id,
        assignmentId: assignment.id,
        body,
        revision: await assignmentSubmissionRepository.nextRevision(view.enrollment.id, assignment.id),
        status: submitting ? AssignmentSubmissionStatus.SUBMITTED : AssignmentSubmissionStatus.IN_PROGRESS,
        isLate: submitting ? late : false,
        submittedAt: submitting ? new Date() : null,
      });
    }

    await progressService.recomputeEnrollment(view.enrollment.id);
    const next = await catalogForAssignment(user, assignment, batchId);
    return { submission: toAttemptPayload(assignment, saved), catalog: next };
  },

  async addFile(user: AuthUser, submissionId: string, file: Express.Multer.File) {
    const submission = await assignmentSubmissionRepository.findSubmission(submissionId);
    if (!submission || submission.enrollment.user.id !== user.id) {
      throw ApiError.notFound("Submission not found");
    }
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    if (!EDITABLE.includes(submission.status)) {
      throw ApiError.forbidden("You can only add files to a draft submission.");
    }
    const assignment = submission.assignment;
    if (!assignment.allowFileUpload) {
      throw ApiError.badRequest("This assignment does not accept file uploads.");
    }
    const error = assertSafeUpload(
      file.originalname,
      file.mimetype,
      assignment.allowedFileTypes,
      assignment.maxFileSizeMb * 1024 * 1024,
      file.size,
    );
    if (error) {
      throw ApiError.badRequest(error);
    }

    const stored = await fileStorage.save(
      {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        folder: `submissions/${assignment.id}/trainee/${user.id}/${submission.id}`,
        visibility: "private",
      },
      "",
    );

    try {
      const row = await assignmentSubmissionRepository.addFile({
        submissionId: submission.id,
        fileName: file.originalname,
        fileKey: stored.key,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageProvider: stored.provider,
      });
      return { file: toFilePayload(row) };
    } catch (error) {
      // A failed database write must not leave an orphaned object behind.
      await fileStorage.delete(stored.key).catch(() => undefined);
      throw error;
    }
  },

  async removeFile(user: AuthUser, submissionId: string, fileId: string) {
    const file = await assignmentSubmissionRepository.findFile(fileId);
    if (!file || file.submissionId !== submissionId || file.submission.enrollment.user.id !== user.id) {
      throw ApiError.notFound("File not found");
    }
    if (!EDITABLE.includes(file.submission.status)) {
      throw ApiError.forbidden("You can only remove files from a draft submission.");
    }
    await assignmentSubmissionRepository.deleteFile(file.id);
    try {
      await deleteStorageObjectIfUnreferenced(file.fileKey);
    } catch (error) {
      throw new ApiError(
        502,
        "The file record was removed but storage cleanup failed. Please retry.",
        "STORAGE_CLEANUP_FAILED",
        error,
      );
    }
    return { deleted: true };
  },

  /** Shared authorization for one submission file: owner trainee or a trainer on that program. */
  async requireSubmissionFile(user: AuthUser, submissionId: string, fileId: string) {
    const file = await assignmentSubmissionRepository.findFile(fileId);
    if (!file || file.submissionId !== submissionId) {
      throw ApiError.notFound("File not found");
    }

    const programId = programIdFromAssignment(file.submission.assignment);
    if (user.role === "TRAINEE") {
      if (file.submission.enrollment.user.id !== user.id) {
        throw ApiError.notFound("File not found");
      }
    } else if (user.role === "TRAINER") {
      await programService.requireTrainerOnProgram(user, programId);
    } else {
      throw ApiError.forbidden("You don't have access to this file.");
    }

    return file;
  },

  async fileAccess(user: AuthUser, submissionId: string, fileId: string) {
    const file = await this.requireSubmissionFile(user, submissionId, fileId);
    const expiresIn = env.signedUrlExpiresSeconds;
    const signed = await fileStorage.signedDownloadUrl(file.fileKey, {
      expiresInSeconds: expiresIn,
      fileName: safeDownloadName(file.fileName),
      mimeType: file.mimeType,
    });
    const role = user.role === "TRAINEE" ? "trainee" : "trainer";

    return {
      url: signed ?? `/api/v1/${role}/submissions/${submissionId}/files/${fileId}`,
      strategy: signed ? ("signed" as const) : ("stream" as const),
      fileName: file.fileName,
      mimeType: file.mimeType || "application/octet-stream",
      fileSize: file.fileSize,
      expiresAt: signed ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    };
  },

  async downloadFile(user: AuthUser, submissionId: string, fileId: string) {
    const file = await this.requireSubmissionFile(user, submissionId, fileId);
    const buffer = await fileStorage.get(file.fileKey);
    if (!buffer) {
      throw ApiError.notFound("This file is currently unavailable.");
    }
    return {
      buffer,
      fileName: safeDownloadName(file.fileName),
      mimeType: file.mimeType || "application/octet-stream",
    };
  },

  async listForTrainer(user: AuthUser, programIdRaw?: unknown, batchIdRaw?: unknown) {
    const scope = await resolveTrainerWorkScope(user, programIdRaw, batchIdRaw);
    const rows = await assignmentSubmissionRepository.findAssignmentsForTrainer(scope.programIds);
    const assignments = [];
    for (const assignment of rows) {
      const submissions = await assignmentSubmissionRepository.findForAssignment(assignment.id, scope.batchId);
      const closedByEnrollment = new Set(
        submissions.filter((row) => CLOSED_ATTEMPT.includes(row.status)).map((row) => row.enrollmentId),
      );
      const pendingByEnrollment = new Set(
        submissions.filter((row) => row.status === AssignmentSubmissionStatus.SUBMITTED).map((row) => row.enrollmentId),
      );
      assignments.push({
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        instructions: assignment.instructions,
        dueDate: assignment.dueDate,
        maxScore: assignment.maxScore,
        lifecycleStatus: assignment.status,
        programId: programIdFromAssignment(assignment),
        programTitle: assignment.day.week.program.title,
        location: `${assignment.day.week.title} · ${assignment.day.title}`,
        submissionCount: closedByEnrollment.size,
        pendingReview: pendingByEnrollment.size,
        allowResubmission: assignment.allowResubmission,
        allowLateSubmission: assignment.allowLateSubmission,
      });
    }
    return { assignments };
  },

  async getForTrainer(user: AuthUser, assignmentId: string, programIdRaw?: unknown, batchIdRaw?: unknown) {
    const assignment = await assignmentSubmissionRepository.findAssignment(assignmentId);
    if (!assignment) {
      throw ApiError.notFound("Assignment not found");
    }
    const programId = programIdFromAssignment(assignment);
    const scope = await resolveTrainerWorkScope(user, programIdRaw, batchIdRaw);
    if (!scope.programIds.includes(programId)) {
      throw ApiError.forbidden();
    }
    if (scope.programId && scope.programId !== programId) {
      throw ApiError.badRequest("Assignment does not belong to that course");
    }
    await programService.requireTrainerOnProgram(user, programId);
    const submissions = await assignmentSubmissionRepository.findForAssignment(assignment.id, scope.batchId);
    const attachments = await contentAttachmentRepository.listForAssignment(assignment.id);
    const enrollments = await enrollmentRepository.findRoster(programId, scope.batchId);
    const byEnrollment = new Map<string, typeof submissions>();
    for (const row of submissions) {
      const list = byEnrollment.get(row.enrollmentId) ?? [];
      list.push(row);
      byEnrollment.set(row.enrollmentId, list);
    }

    const roster = enrollments.map((enrollment) => {
      const attempts = (byEnrollment.get(enrollment.id) ?? []).sort((a, b) => b.revision - a.revision);
      const latest = attempts[0] ?? null;
      return {
        enrollmentId: enrollment.id,
        trainee: enrollment.user,
        traineeId: enrollment.userId,
        batch: enrollment.batch,
        status: latest?.status ?? "NOT_STARTED",
        latest: latest ? toAttemptPayload(assignment, latest) : null,
        attempts: attempts.map((row) => toAttemptPayload(assignment, row)),
      };
    });

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        instructions: assignment.instructions,
        dueDate: assignment.dueDate,
        maxScore: assignment.maxScore,
        lifecycleStatus: assignment.status,
        programId,
        programTitle: assignment.day.week.program.title,
        location: `${assignment.day.week.title} · ${assignment.day.title}`,
        allowFileUpload: assignment.allowFileUpload,
        allowTextResponse: assignment.allowTextResponse,
        allowResubmission: assignment.allowResubmission,
        allowLateSubmission: assignment.allowLateSubmission,
        maxAttempts: assignment.maxAttempts,
        allowedFileTypes: assignment.allowedFileTypes,
        maxFileSizeMb: assignment.maxFileSizeMb,
        attachments: attachments.map(publicAttachment),
      },
      submissions: submissions.map((row) => ({
        ...toAttemptPayload(assignment, row),
        trainee: row.enrollment.user,
        batch: row.enrollment.batch,
        enrollmentId: row.enrollmentId,
      })),
      roster,
    };
  },

  async review(
    user: AuthUser,
    submissionId: string,
    input: { status: "GRADED" | "CHANGES_REQUESTED" | "COMPLETED"; score?: number | null; comment?: string },
  ) {
    const submission = await assignmentSubmissionRepository.findSubmission(submissionId);
    if (!submission) {
      throw ApiError.notFound("Submission not found");
    }

    await programService.requireTrainerOnProgram(user, programIdFromAssignment(submission.assignment));

    if (!REVIEWABLE.includes(submission.status) && submission.status !== AssignmentSubmissionStatus.COMPLETED) {
      throw ApiError.badRequest("This submission cannot be reviewed in its current state");
    }

    const nextStatus = input.status as AssignmentSubmissionStatus;
    let score = input.score ?? submission.score;

    if (nextStatus === AssignmentSubmissionStatus.GRADED || nextStatus === AssignmentSubmissionStatus.COMPLETED) {
      if (score === null || score === undefined) {
        throw ApiError.badRequest("A score is required to grade this assignment");
      }
      if (!Number.isInteger(score) || score < 0 || score > submission.assignment.maxScore) {
        throw ApiError.badRequest("Score must be between 0 and the maximum score.");
      }
    }

    if (nextStatus === AssignmentSubmissionStatus.CHANGES_REQUESTED) {
      score = submission.score;
    }

    const saved = await assignmentSubmissionRepository.review(submission.id, {
      status: nextStatus,
      score: score ?? null,
      trainerComment: input.comment ?? submission.trainerComment,
      gradedByUserId: user.id,
    });

    await progressService.recomputeEnrollment(submission.enrollmentId);

    return {
      submission: {
        ...toAttemptPayload(saved.assignment, saved),
        trainee: saved.enrollment.user,
      },
    };
  },
};
