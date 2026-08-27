import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { contentAttachmentRepository } from "../repositories/content-attachment.repository";
import { curriculumRepository } from "../repositories/curriculum.repository";
import { fileStorage } from "../storage";
import { assertUploadFile, maxBytesForPurpose, type UploadPurpose } from "../storage/file-types";
import { buildObjectKey } from "../storage/object-keys";
import { programService } from "./program.service";
import { progressService } from "./progress.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";
import { safeDownloadName } from "../utils/submission-files";

export type CurriculumItemType = "VIDEO" | "RESOURCE" | "REEL";

export type UploadedFileMeta = {
  key: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageProvider: string;
  url: string | null;
};

export type FileAccess = {
  url: string;
  strategy: "signed" | "stream" | "public";
  fileName: string;
  mimeType: string;
  fileSize: number;
  expiresAt: string | null;
};

const CURRICULUM_PURPOSE: Record<CurriculumItemType, UploadPurpose> = {
  VIDEO: "VIDEO",
  RESOURCE: "RESOURCE",
  REEL: "REEL",
};

function assertPurpose(value: unknown): UploadPurpose {
  const purpose = String(value ?? "").trim().toUpperCase();
  const allowed: UploadPurpose[] = [
    "VIDEO",
    "REEL",
    "RESOURCE",
    "LESSON_ATTACHMENT",
    "ASSIGNMENT_ATTACHMENT",
  ];
  if (!allowed.includes(purpose as UploadPurpose)) {
    throw ApiError.badRequest("Unsupported upload type.");
  }
  return purpose as UploadPurpose;
}

function folderForPurpose(purpose: UploadPurpose, scope: { programId: string; weekId?: string; dayId?: string; contentId?: string }): string {
  const base = `programs/${scope.programId}`;
  const week = scope.weekId ? `${base}/weeks/${scope.weekId}` : base;
  const day = scope.dayId ? `${week}/days/${scope.dayId}` : week;
  const segment = purpose.toLowerCase();
  return scope.contentId ? `${day}/content/${segment}/${scope.contentId}` : `${day}/content/${segment}`;
}

async function trainerUploadScope(user: AuthUser, dayId?: string) {
  if (!dayId) {
    throw ApiError.badRequest("Choose where this file belongs before uploading.");
  }
  const day = await curriculumRepository.day(dayId);
  if (!day) {
    throw ApiError.notFound("Day not found");
  }
  await programService.requireEditable(user, day.week.programId);
  return { programId: day.week.programId, weekId: day.weekId, dayId: day.id };
}

function toUploaded(stored: {
  key: string;
  originalName: string;
  mimeType: string;
  size: number;
  provider: string;
  url: string | null;
}): UploadedFileMeta {
  return {
    key: stored.key,
    fileName: stored.originalName,
    mimeType: stored.mimeType,
    fileSize: stored.size,
    storageProvider: stored.provider,
    url: stored.url,
  };
}

async function accessFor(
  file: { fileKey: string; fileName: string; mimeType: string; fileSize: number; storageProvider?: string | null },
  streamPath: string,
): Promise<FileAccess> {
  const expiresIn = env.signedUrlExpiresSeconds;
  const signed = await fileStorage.signedDownloadUrl(file.fileKey, {
    expiresInSeconds: expiresIn,
    fileName: safeDownloadName(file.fileName),
    mimeType: file.mimeType,
  });

  if (signed) {
    return {
      url: signed,
      strategy: "signed",
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  return {
    url: streamPath,
    strategy: "stream",
    fileName: file.fileName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    expiresAt: null,
  };
}

async function loadCurriculumItem(itemType: CurriculumItemType, itemId: string) {
  const record =
    itemType === "VIDEO"
      ? await curriculumRepository.video(itemId)
      : itemType === "RESOURCE"
        ? await curriculumRepository.resource(itemId)
        : await curriculumRepository.reel(itemId);
  if (!record) {
    throw ApiError.notFound("Content not found");
  }
  return record;
}

function requireStoredFile(record: {
  fileKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  storageProvider: string | null;
}) {
  if (!record.fileKey) {
    throw ApiError.notFound("This item has no stored file.");
  }
  return {
    fileKey: record.fileKey,
    fileName: record.fileName ?? "file",
    mimeType: record.mimeType ?? "application/octet-stream",
    fileSize: record.fileSize ?? 0,
    storageProvider: record.storageProvider ?? fileStorage.provider,
  };
}

async function assertTraineeItemUnlocked(
  user: AuthUser,
  itemType: CurriculumItemType,
  itemId: string,
  programId: string,
  batchId?: string,
) {
  let view;
  try {
    view = await progressService.getLearnView(user, programId, batchId);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      throw ApiError.forbidden("You don't have access to this file.");
    }
    throw error;
  }

  for (const week of view.weeks) {
    for (const day of week.days) {
      const match = day.items.find((item) => item.type === itemType && item.id === itemId);
      if (match) {
        if (match.status === "LOCKED") {
          throw new ApiError(403, match.reason ?? "This content is locked.", "CONTENT_LOCKED");
        }
        return;
      }
    }
  }
  throw ApiError.notFound("Content not found");
}

async function assertTraineeLessonUnlocked(user: AuthUser, lessonId: string, programId: string, batchId?: string) {
  let view;
  try {
    view = await progressService.getLearnView(user, programId, batchId);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      throw ApiError.forbidden("You don't have access to this file.");
    }
    throw error;
  }
  for (const week of view.weeks) {
    for (const day of week.days) {
      const match = day.items.find((item) => item.type === "LESSON" && item.id === lessonId);
      if (match) {
        if (match.status === "LOCKED") {
          throw new ApiError(403, match.reason ?? "This content is locked.", "CONTENT_LOCKED");
        }
        return;
      }
    }
  }
  throw ApiError.notFound("Content not found");
}

async function assertTraineeAssignmentUnlocked(user: AuthUser, assignmentId: string, programId: string, batchId?: string) {
  let view;
  try {
    view = await progressService.getComputation(user, programId, batchId);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      throw ApiError.forbidden("You don't have access to this file.");
    }
    throw error;
  }
  const access = progressService.assignmentAccess(view, assignmentId);
  if (access.status === "LOCKED") {
    throw new ApiError(403, access.reason ?? "This assignment is locked.", "CONTENT_LOCKED");
  }
}

export const fileService = {
  maxBytesForPurpose,

  /** Server-side multipart upload for trainer curriculum media and attachments. */
  async uploadTrainerFile(
    user: AuthUser,
    file: Express.Multer.File,
    input: { purpose?: unknown; dayId?: string; contentId?: string },
  ): Promise<{ file: UploadedFileMeta }> {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    const purpose = assertPurpose(input.purpose);
    const scope = await trainerUploadScope(user, input.dayId);
    const error = assertUploadFile({
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      purpose,
    });
    if (error) {
      throw ApiError.badRequest(error);
    }

    const stored = await fileStorage.save(
      {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        folder: folderForPurpose(purpose, { ...scope, contentId: input.contentId }),
        visibility: "private",
      },
      "",
    );

    return { file: toUploaded(stored) };
  },

  /** Short-lived direct-to-R2 upload URL for large media. */
  async createUploadTicket(
    user: AuthUser,
    input: { purpose?: unknown; dayId?: string; contentId?: string; fileName?: string; mimeType?: string; fileSize?: number },
  ) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    const purpose = assertPurpose(input.purpose);
    const scope = await trainerUploadScope(user, input.dayId);
    const fileName = String(input.fileName ?? "").trim();
    const mimeType = String(input.mimeType ?? "").trim();
    const fileSize = Number(input.fileSize ?? 0);
    if (!fileName || !mimeType || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw ApiError.badRequest("Provide the file name, type, and size.");
    }
    const error = assertUploadFile({ fileName, mimeType, size: fileSize, purpose });
    if (error) {
      throw ApiError.badRequest(error);
    }

    const key = buildObjectKey(folderForPurpose(purpose, { ...scope, contentId: input.contentId }), fileName, mimeType);
    const directEligible = (purpose === "VIDEO" || purpose === "REEL") && fileSize >= 4 * 1024 * 1024;
    if (!directEligible) {
      return { direct: false as const, key: null, upload: null };
    }
    const upload = await fileStorage.signedUploadUrl(key, mimeType);
    if (!upload) {
      return { direct: false as const, key: null, upload: null };
    }
    return { direct: true as const, key, upload };
  },

  /** Confirms a direct upload landed in storage before metadata is saved. */
  async confirmUpload(
    user: AuthUser,
    input: { key?: string; dayId?: string; fileName?: string; mimeType?: string; fileSize?: number },
  ): Promise<{ file: UploadedFileMeta }> {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    const scope = await trainerUploadScope(user, input.dayId);
    const key = String(input.key ?? "").trim();
    if (!key.startsWith(`programs/${scope.programId}/`)) {
      throw ApiError.forbidden("You don't have access to this file.");
    }
    const exists = await fileStorage.exists(key);
    if (!exists) {
      throw ApiError.badRequest("Upload failed. Please try again.");
    }
    return {
      file: {
        key,
        fileName: String(input.fileName ?? "file"),
        mimeType: String(input.mimeType ?? "application/octet-stream"),
        fileSize: Number(input.fileSize ?? 0),
        storageProvider: fileStorage.provider,
        url: null,
      },
    };
  },

  /** Trainer preview/download of curriculum media they manage. */
  async trainerItemAccess(user: AuthUser, itemType: CurriculumItemType, itemId: string): Promise<FileAccess> {
    const record = await loadCurriculumItem(itemType, itemId);
    await programService.requireTrainerOnProgram(user, record.day.week.programId);
    const file = requireStoredFile(record);
    return accessFor(file, `/api/v1/trainer/items/${itemType}/${itemId}/file/stream`);
  },

  /** Admin review of curriculum media on a submitted or published program. */
  async adminItemAccess(user: AuthUser, itemType: CurriculumItemType, itemId: string): Promise<FileAccess> {
    if (!isProgramReviewer(user.role)) {
      throw ApiError.forbidden("You don't have access to this file.");
    }
    const record = await loadCurriculumItem(itemType, itemId);
    await programService.requireCanView(user, record.day.week.programId);
    const file = requireStoredFile(record);
    return accessFor(file, `/api/v1/admin/items/${itemType}/${itemId}/file/stream`);
  },

  /** Trainee access to curriculum media, gated by enrollment and unlock rules. */
  async traineeItemAccess(
    user: AuthUser,
    itemType: CurriculumItemType,
    itemId: string,
    batchId?: string,
  ): Promise<FileAccess> {
    const record = await loadCurriculumItem(itemType, itemId);
    await assertTraineeItemUnlocked(user, itemType, itemId, record.day.week.programId, batchId);
    const file = requireStoredFile(record);
    return accessFor(file, `/api/v1/trainee/items/${itemType}/${itemId}/file/stream`);
  },

  async streamCurriculumFile(
    user: AuthUser,
    itemType: CurriculumItemType,
    itemId: string,
    batchId?: string,
  ) {
    const record = await loadCurriculumItem(itemType, itemId);
    if (user.role === "TRAINEE") {
      await assertTraineeItemUnlocked(user, itemType, itemId, record.day.week.programId, batchId);
    } else if (user.role === "TRAINER") {
      await programService.requireTrainerOnProgram(user, record.day.week.programId);
    } else if (isProgramReviewer(user.role)) {
      await programService.requireCanView(user, record.day.week.programId);
    } else {
      throw ApiError.forbidden("You don't have access to this file.");
    }
    const file = requireStoredFile(record);
    const buffer = await fileStorage.get(file.fileKey);
    if (!buffer) {
      throw ApiError.notFound("This file is currently unavailable.");
    }
    return { buffer, fileName: safeDownloadName(file.fileName), mimeType: file.mimeType };
  },

  async listLessonAttachments(user: AuthUser, lessonId: string) {
    const lesson = await curriculumRepository.lesson(lessonId);
    if (!lesson) {
      throw ApiError.notFound("Lesson not found");
    }
    await programService.requireTrainerOnProgram(user, lesson.day.week.programId);
    const attachments = await contentAttachmentRepository.listForLesson(lessonId);
    return { attachments: attachments.map(publicAttachment) };
  },

  async addLessonAttachment(user: AuthUser, lessonId: string, file: Express.Multer.File, title?: string) {
    const lesson = await curriculumRepository.lesson(lessonId);
    if (!lesson) {
      throw ApiError.notFound("Lesson not found");
    }
    await programService.requireEditable(user, lesson.day.week.programId);
    const error = assertUploadFile({
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      purpose: "LESSON_ATTACHMENT",
    });
    if (error) {
      throw ApiError.badRequest(error);
    }

    const stored = await fileStorage.save(
      {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        folder: folderForPurpose("LESSON_ATTACHMENT", {
          programId: lesson.day.week.programId,
          weekId: lesson.day.weekId,
          dayId: lesson.dayId,
          contentId: lesson.id,
        }),
        visibility: "private",
      },
      "",
    );

    try {
      const row = await contentAttachmentRepository.create({
        lessonId,
        sortOrder: await contentAttachmentRepository.nextSortOrder({ lessonId }),
        title: title?.trim() || "",
        fileName: file.originalname,
        fileKey: stored.key,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageProvider: stored.provider,
        uploadedByUserId: user.id,
      });
      return { attachment: publicAttachment(row) };
    } catch (error) {
      await fileStorage.delete(stored.key).catch(() => undefined);
      throw error;
    }
  },

  async addAssignmentAttachment(user: AuthUser, assignmentId: string, file: Express.Multer.File, title?: string) {
    const assignment = await curriculumRepository.assignment(assignmentId);
    if (!assignment) {
      throw ApiError.notFound("Assignment not found");
    }
    await programService.requireEditable(user, assignment.day.week.programId);
    const error = assertUploadFile({
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      purpose: "ASSIGNMENT_ATTACHMENT",
    });
    if (error) {
      throw ApiError.badRequest(error);
    }

    const stored = await fileStorage.save(
      {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        folder: folderForPurpose("ASSIGNMENT_ATTACHMENT", {
          programId: assignment.day.week.programId,
          weekId: assignment.day.weekId,
          dayId: assignment.dayId,
          contentId: assignment.id,
        }),
        visibility: "private",
      },
      "",
    );

    try {
      const row = await contentAttachmentRepository.create({
        assignmentId,
        sortOrder: await contentAttachmentRepository.nextSortOrder({ assignmentId }),
        title: title?.trim() || "",
        fileName: file.originalname,
        fileKey: stored.key,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageProvider: stored.provider,
        uploadedByUserId: user.id,
      });
      return { attachment: publicAttachment(row) };
    } catch (error) {
      await fileStorage.delete(stored.key).catch(() => undefined);
      throw error;
    }
  },

  async removeAttachment(user: AuthUser, attachmentId: string) {
    const attachment = await contentAttachmentRepository.findById(attachmentId);
    if (!attachment) {
      throw ApiError.notFound("File not found");
    }
    const programId =
      attachment.lesson?.day.week.programId ?? attachment.assignment?.day.week.programId ?? null;
    if (!programId) {
      throw ApiError.notFound("File not found");
    }
    await programService.requireEditable(user, programId);

    const references = await countStorageReferences(attachment.fileKey);
    await contentAttachmentRepository.delete(attachment.id);
    if (references <= 1) {
      try {
        await fileStorage.delete(attachment.fileKey);
      } catch (error) {
        throw new ApiError(
          502,
          "The file record was removed but storage cleanup failed. Please retry.",
          "STORAGE_CLEANUP_FAILED",
          error,
        );
      }
    }
    return { deleted: true };
  },

  async attachmentAccess(user: AuthUser, attachmentId: string, batchId?: string): Promise<FileAccess> {
    const attachment = await contentAttachmentRepository.findById(attachmentId);
    if (!attachment) {
      throw ApiError.notFound("File not found");
    }
    const programId =
      attachment.lesson?.day.week.programId ?? attachment.assignment?.day.week.programId ?? null;
    if (!programId) {
      throw ApiError.notFound("File not found");
    }

    if (user.role === "TRAINEE") {
      if (attachment.lessonId) {
        await assertTraineeLessonUnlocked(user, attachment.lessonId, programId, batchId);
      } else if (attachment.assignmentId) {
        await assertTraineeAssignmentUnlocked(user, attachment.assignmentId, programId, batchId);
      } else {
        throw ApiError.notFound("File not found");
      }
    } else if (user.role === "TRAINER") {
      await programService.requireTrainerOnProgram(user, programId);
    } else if (isProgramReviewer(user.role)) {
      await programService.requireCanView(user, programId);
    } else {
      throw ApiError.forbidden("You don't have access to this file.");
    }

    const role = user.role === "TRAINEE" ? "trainee" : user.role === "TRAINER" ? "trainer" : "admin";
    return accessFor(attachment, `/api/v1/${role}/attachments/${attachment.id}/file/stream`);
  },

  async streamAttachment(user: AuthUser, attachmentId: string, batchId?: string) {
    const access = await this.attachmentAccess(user, attachmentId, batchId);
    const attachment = await contentAttachmentRepository.findById(attachmentId);
    if (!attachment) {
      throw ApiError.notFound("File not found");
    }
    const buffer = await fileStorage.get(attachment.fileKey);
    if (!buffer) {
      throw ApiError.notFound("This file is currently unavailable.");
    }
    return { buffer, fileName: safeDownloadName(access.fileName), mimeType: access.mimeType };
  },
};

export function publicAttachment(row: {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
}) {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
  };
}

/** Counts every database row that points at one storage object. */
export async function countStorageReferences(fileKey: string): Promise<number> {
  const [attachments, videos, resources, reels, submissionFiles] = await Promise.all([
    prisma.contentAttachment.count({ where: { fileKey } }),
    prisma.video.count({ where: { fileKey } }),
    prisma.resource.count({ where: { fileKey } }),
    prisma.reel.count({ where: { fileKey } }),
    prisma.assignmentSubmissionFile.count({ where: { fileKey } }),
  ]);
  return attachments + videos + resources + reels + submissionFiles;
}

/** Deletes a storage object only when no other database row still references it. */
export async function deleteStorageObjectIfUnreferenced(fileKey: string | null | undefined): Promise<void> {
  if (!fileKey) {
    return;
  }
  const references = await countStorageReferences(fileKey);
  if (references > 0) {
    return;
  }
  await fileStorage.delete(fileKey);
}

export type CurriculumScope = {
  programId?: string;
  weekId?: string;
  dayId?: string;
  lessonId?: string;
  assignmentId?: string;
};

function dayFilter(scope: CurriculumScope) {
  if (scope.dayId) {
    return { dayId: scope.dayId };
  }
  if (scope.weekId) {
    return { day: { weekId: scope.weekId } };
  }
  if (scope.programId) {
    return { day: { week: { programId: scope.programId } } };
  }
  return null;
}

/** Collects every stored object key inside a curriculum scope before its rows are deleted. */
export async function collectStorageKeys(scope: CurriculumScope): Promise<string[]> {
  const keys: string[] = [];

  if (scope.lessonId) {
    const rows = await prisma.contentAttachment.findMany({
      where: { lessonId: scope.lessonId },
      select: { fileKey: true },
    });
    keys.push(...rows.map((row) => row.fileKey));
    return keys;
  }

  if (scope.assignmentId) {
    const [attachments, submissionFiles] = await Promise.all([
      prisma.contentAttachment.findMany({ where: { assignmentId: scope.assignmentId }, select: { fileKey: true } }),
      prisma.assignmentSubmissionFile.findMany({
        where: { submission: { assignmentId: scope.assignmentId } },
        select: { fileKey: true },
      }),
    ]);
    keys.push(...attachments.map((row) => row.fileKey), ...submissionFiles.map((row) => row.fileKey));
    return keys;
  }

  const where = dayFilter(scope);
  if (!where) {
    return keys;
  }

  const [videos, resources, reels, lessonAttachments, assignmentAttachments, submissionFiles] = await Promise.all([
    prisma.video.findMany({ where: { ...where, fileKey: { not: null } }, select: { fileKey: true } }),
    prisma.resource.findMany({ where: { ...where, fileKey: { not: null } }, select: { fileKey: true } }),
    prisma.reel.findMany({ where: { ...where, fileKey: { not: null } }, select: { fileKey: true } }),
    prisma.contentAttachment.findMany({ where: { lesson: where }, select: { fileKey: true } }),
    prisma.contentAttachment.findMany({ where: { assignment: where }, select: { fileKey: true } }),
    prisma.assignmentSubmissionFile.findMany({
      where: { submission: { assignment: where } },
      select: { fileKey: true },
    }),
  ]);

  for (const row of [...videos, ...resources, ...reels]) {
    if (row.fileKey) {
      keys.push(row.fileKey);
    }
  }
  keys.push(
    ...lessonAttachments.map((row) => row.fileKey),
    ...assignmentAttachments.map((row) => row.fileKey),
    ...submissionFiles.map((row) => row.fileKey),
  );
  return keys;
}

/** Best-effort cleanup for keys whose database rows were already removed. */
export async function purgeStorageKeys(keys: string[]): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const key of new Set(keys)) {
    try {
      await deleteStorageObjectIfUnreferenced(key);
    } catch {
      failed.push(key);
    }
  }
  return { failed };
}
