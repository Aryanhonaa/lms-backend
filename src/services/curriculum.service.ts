import { QuizKind } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { curriculumRepository } from "../repositories/curriculum.repository";
import { fileStorage } from "../storage";
import { collectStorageKeys, deleteStorageObjectIfUnreferenced, purgeStorageKeys } from "./file.service";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";

type StoredFileInput = {
  fileKey?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
};

/** Maps an uploaded object reference onto a curriculum row without touching legacy URL content. */
function storedFileData(input: StoredFileInput) {
  if (!("fileKey" in input)) {
    return {};
  }
  if (!input.fileKey) {
    return {
      fileKey: null,
      fileName: null,
      mimeType: null,
      fileSize: null,
      storageProvider: null,
    };
  }
  return {
    fileKey: input.fileKey,
    fileName: input.fileName ?? "file",
    mimeType: input.mimeType ?? "application/octet-stream",
    fileSize: input.fileSize ?? 0,
    storageProvider: fileStorage.provider,
  };
}

/** Uploaded curriculum media keeps a stable internal reference in the existing url column. */
function urlForStoredFile(fileKey: string | null | undefined, fallback: string): string {
  return fileKey ? `storage:${fileKey}` : fallback;
}

type QuizInput = {
  title: string;
  description?: string;
  passingScore?: number;
  timeLimitMin?: number | null;
  maxAttempts?: number | null;
  randomized?: boolean;
  questionDrawCount?: number | null;
  revealMode?: "HIDDEN" | "IMMEDIATE" | "SCHEDULED";
  revealAt?: string | Date | null;
  questions?: Array<{
    prompt: string;
    points?: number;
    options: Array<{ label: string; isCorrect: boolean }>;
  }>;
};

function quizRevealData(
  input: QuizInput,
  previous?: { revealMode: string; revealAt: Date | null },
) {
  const revealMode = input.revealMode ?? previous?.revealMode ?? "IMMEDIATE";
  if (revealMode === "SCHEDULED" && !input.revealAt && !previous?.revealAt) {
    throw ApiError.badRequest("Choose when answers become visible.");
  }
  const revealAt =
    revealMode === "SCHEDULED"
      ? parseDate(input.revealAt) ?? previous?.revealAt ?? null
      : null;
  if (revealMode === "SCHEDULED" && !revealAt) {
    throw ApiError.badRequest("Choose when answers become visible.");
  }
  const scheduleChanged =
    !previous ||
    previous.revealMode !== revealMode ||
    (previous.revealAt?.getTime() ?? 0) !== (revealAt?.getTime() ?? 0);
  return {
    revealMode: revealMode as "HIDDEN" | "IMMEDIATE" | "SCHEDULED",
    revealAt,
    ...(scheduleChanged ? { answersRevealedAnnouncedAt: null } : {}),
  };
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

const LINKABLE_ITEM_TYPES = ["LESSON", "VIDEO", "RESOURCE", "REEL"] as const;
type LinkableItemType = (typeof LINKABLE_ITEM_TYPES)[number];

async function unlinkAssignmentsFrom(itemType: LinkableItemType, itemId: string) {
  await prisma.assignment.updateMany({
    where: { linkedItemType: itemType, linkedItemId: itemId },
    data: { linkedItemType: null, linkedItemId: null },
  });
}

async function resolveLinkedContent(
  dayId: string,
  linkedItemType?: string | null,
  linkedItemId?: string | null,
): Promise<{ linkedItemType: string | null; linkedItemId: string | null }> {
  if (!linkedItemType && !linkedItemId) {
    return { linkedItemType: null, linkedItemId: null };
  }
  if (!linkedItemType || !linkedItemId) {
    throw ApiError.badRequest("Choose a file for this assignment, or leave it unlinked.");
  }
  if (!(LINKABLE_ITEM_TYPES as readonly string[]).includes(linkedItemType)) {
    throw ApiError.badRequest("Assignments can only follow a lesson, video, document, or reel.");
  }

  const found =
    linkedItemType === "LESSON"
      ? await prisma.lesson.findFirst({ where: { id: linkedItemId, dayId }, select: { id: true } })
      : linkedItemType === "VIDEO"
        ? await prisma.video.findFirst({ where: { id: linkedItemId, dayId }, select: { id: true } })
        : linkedItemType === "RESOURCE"
          ? await prisma.resource.findFirst({ where: { id: linkedItemId, dayId }, select: { id: true } })
          : await prisma.reel.findFirst({ where: { id: linkedItemId, dayId }, select: { id: true } });

  if (!found) {
    throw ApiError.badRequest("That file is not on this day.");
  }
  return { linkedItemType, linkedItemId };
}

function combineDateAndTime(date: string | undefined, time: string | undefined): Date | null {
  if (!date) {
    return null;
  }
  const clock = time ? (time.length === 5 ? `${time}:00` : time) : "00:00:00";
  return new Date(`${date}T${clock}.000Z`);
}

type SessionInput = {
  title?: string;
  description?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  startsAt?: string | Date;
  endsAt?: string | Date | null;
  meetingLink?: string | null;
  meetingUrl?: string | null;
};

function sessionTimes(input: SessionInput): { startsAt: Date; endsAt: Date | null; meetingUrl: string | null | undefined } {
  const startsAt =
    parseDate(input.startsAt) ?? combineDateAndTime(input.date, input.startTime) ?? new Date();
  const endsAt =
    parseDate(input.endsAt ?? undefined) ??
    (input.date && input.endTime ? combineDateAndTime(input.date, input.endTime) : null) ??
    new Date(startsAt.getTime() + 60 * 60 * 1000);
  return {
    startsAt,
    endsAt,
    meetingUrl: input.meetingLink !== undefined ? input.meetingLink : input.meetingUrl,
  };
}

function assertQuestions(questions: QuizInput["questions"]) {
  if (!questions) {
    return;
  }

  for (const question of questions) {
    if (question.options.length < 2 || question.options.length > 6) {
      throw ApiError.badRequest("Each question needs between 2 and 6 options");
    }
    const correct = question.options.filter((option) => option.isCorrect).length;
    if (correct !== 1) {
      throw ApiError.badRequest("Each question needs exactly one correct option");
    }
  }
}

async function assertDrawCount(
  drawCount: number | null | undefined,
  bankSize: number,
) {
  if (drawCount == null) {
    return;
  }
  if (drawCount > bankSize) {
    throw ApiError.badRequest("Questions per attempt cannot exceed the number of questions in the bank");
  }
}

async function createQuestions(quizId: string, questions: NonNullable<QuizInput["questions"]>) {
  for (const [questionIndex, question] of questions.entries()) {
    const created = await prisma.question.create({
      data: {
        quizId,
        sortOrder: questionIndex,
        prompt: question.prompt,
        points: question.points ?? 1,
      },
    });

    await prisma.questionOption.createMany({
      data: question.options.map((option, optionIndex) => ({
        questionId: created.id,
        sortOrder: optionIndex,
        label: option.label,
        isCorrect: option.isCorrect,
      })),
    });
  }
}

export const curriculumService = {
  async addWeek(user: AuthUser, programId: string, input: { title: string; description?: string; objectives?: string[]; startDate?: string | Date | null; endDate?: string | Date | null }) {
    await programService.requireEditable(user, programId);
    const sortOrder = await curriculumRepository.nextWeekOrder(programId);
    await prisma.week.create({
      data: {
        programId,
        sortOrder,
        title: input.title,
        description: input.description ?? "",
        objectives: input.objectives ?? [],
        startDate: parseDate(input.startDate),
        endDate: parseDate(input.endDate),
      },
    });
    return programService.getTreeForUser(user, programId);
  },

  async updateWeek(user: AuthUser, weekId: string, input: Partial<{ title: string; description: string; objectives: string[]; startDate: string | Date | null; endDate: string | Date | null }>) {
    const week = await curriculumRepository.week(weekId);
    if (!week) {
      throw ApiError.notFound("Week not found");
    }
    await programService.requireEditable(user, week.programId);
    await prisma.week.update({
      where: { id: weekId },
      data: {
        ...("title" in input ? { title: input.title } : {}),
        ...("description" in input ? { description: input.description } : {}),
        ...("objectives" in input ? { objectives: input.objectives } : {}),
        ...("startDate" in input ? { startDate: parseDate(input.startDate) } : {}),
        ...("endDate" in input ? { endDate: parseDate(input.endDate) } : {}),
      },
    });
    return programService.getTreeForUser(user, week.programId);
  },

  async deleteWeek(user: AuthUser, weekId: string) {
    const week = await curriculumRepository.week(weekId);
    if (!week) {
      throw ApiError.notFound("Week not found");
    }
    await programService.requireEditable(user, week.programId);
    const keys = await collectStorageKeys({ weekId });
    await prisma.week.delete({ where: { id: weekId } });
    await purgeStorageKeys(keys);
    return programService.getTreeForUser(user, week.programId);
  },

  async addDay(user: AuthUser, weekId: string, input: { title: string }) {
    const week = await curriculumRepository.week(weekId);
    if (!week) {
      throw ApiError.notFound("Week not found");
    }
    await programService.requireEditable(user, week.programId);
    const sortOrder = await curriculumRepository.nextDayOrder(weekId);
    await prisma.day.create({ data: { weekId, sortOrder, title: input.title } });
    return programService.getTreeForUser(user, week.programId);
  },

  async updateDay(user: AuthUser, dayId: string, input: { title?: string }) {
    const day = await curriculumRepository.day(dayId);
    if (!day) {
      throw ApiError.notFound("Day not found");
    }
    await programService.requireEditable(user, day.week.programId);
    await prisma.day.update({ where: { id: dayId }, data: { title: input.title } });
    return programService.getTreeForUser(user, day.week.programId);
  },

  async deleteDay(user: AuthUser, dayId: string) {
    const day = await curriculumRepository.day(dayId);
    if (!day) {
      throw ApiError.notFound("Day not found");
    }
    await programService.requireEditable(user, day.week.programId);
    const keys = await collectStorageKeys({ dayId });
    await prisma.day.delete({ where: { id: dayId } });
    await purgeStorageKeys(keys);
    return programService.getTreeForUser(user, day.week.programId);
  },

  async addLesson(user: AuthUser, dayId: string, input: { title: string; description?: string; durationMin?: number; required?: boolean }) {
    const day = await curriculumRepository.day(dayId);
    if (!day) {
      throw ApiError.notFound("Day not found");
    }
    await programService.requireEditable(user, day.week.programId);
    const sortOrder = await curriculumRepository.nextLessonOrder(dayId);
    await prisma.lesson.create({
      data: {
        dayId,
        sortOrder,
        title: input.title,
        description: input.description ?? "",
        durationMin: input.durationMin ?? 0,
        required: input.required ?? true,
      },
    });
    return programService.getTreeForUser(user, day.week.programId);
  },

  async updateLesson(user: AuthUser, id: string, input: Partial<{ title: string; description: string; durationMin: number; required: boolean }>) {
    const lesson = await curriculumRepository.lesson(id);
    if (!lesson) {
      throw ApiError.notFound("Lesson not found");
    }
    await programService.requireEditable(user, lesson.day.week.programId);
    await prisma.lesson.update({ where: { id }, data: input });
    return programService.getTreeForUser(user, lesson.day.week.programId);
  },

  async deleteLesson(user: AuthUser, id: string) {
    const lesson = await curriculumRepository.lesson(id);
    if (!lesson) {
      throw ApiError.notFound("Lesson not found");
    }
    await programService.requireEditable(user, lesson.day.week.programId);
    await unlinkAssignmentsFrom("LESSON", id);
    const keys = await collectStorageKeys({ lessonId: id });
    await prisma.lesson.delete({ where: { id } });
    await purgeStorageKeys(keys);
    return programService.getTreeForUser(user, lesson.day.week.programId);
  },

  async addVideo(
    user: AuthUser,
    dayId: string,
    input: { title: string; source: "YOUTUBE" | "UPLOADED" | "EXTERNAL"; url?: string; durationMin?: number } & StoredFileInput,
  ) {
    const day = await curriculumRepository.day(dayId);
    if (!day) {
      throw ApiError.notFound("Day not found");
    }
    await programService.requireEditable(user, day.week.programId);
    if (!input.fileKey && !input.url) {
      throw ApiError.badRequest("Add a video file or URL");
    }
    const sortOrder = await curriculumRepository.nextVideoOrder(dayId);
    await prisma.video.create({
      data: {
        dayId,
        sortOrder,
        title: input.title,
        source: input.source,
        url: urlForStoredFile(input.fileKey, input.url ?? ""),
        durationMin: input.durationMin ?? 0,
        ...storedFileData(input),
      },
    });
    return programService.getTreeForUser(user, day.week.programId);
  },

  async updateVideo(
    user: AuthUser,
    id: string,
    input: Partial<{ title: string; source: "YOUTUBE" | "UPLOADED" | "EXTERNAL"; url: string; durationMin: number }> & StoredFileInput,
  ) {
    const video = await curriculumRepository.video(id);
    if (!video) {
      throw ApiError.notFound("Video not found");
    }
    await programService.requireEditable(user, video.day.week.programId);
    const replacingFile = "fileKey" in input && input.fileKey !== video.fileKey;
    await prisma.video.update({
      where: { id },
      data: {
        ...("title" in input ? { title: input.title } : {}),
        ...("source" in input ? { source: input.source } : {}),
        ...("durationMin" in input ? { durationMin: input.durationMin } : {}),
        ...storedFileData(input),
        ...(replacingFile || "url" in input
          ? { url: urlForStoredFile(input.fileKey, input.url ?? video.url) }
          : {}),
      },
    });
    if (replacingFile) {
      await deleteStorageObjectIfUnreferenced(video.fileKey);
    }
    return programService.getTreeForUser(user, video.day.week.programId);
  },

  async deleteVideo(user: AuthUser, id: string) {
    const video = await curriculumRepository.video(id);
    if (!video) {
      throw ApiError.notFound("Video not found");
    }
    await programService.requireEditable(user, video.day.week.programId);
    await unlinkAssignmentsFrom("VIDEO", id);
    await prisma.video.delete({ where: { id } });
    await deleteStorageObjectIfUnreferenced(video.fileKey);
    return programService.getTreeForUser(user, video.day.week.programId);
  },

  async addResource(
    user: AuthUser,
    dayId: string,
    input: {
      title: string;
      description?: string;
      url?: string;
      kind: "DOCUMENT" | "ARTICLE" | "GITHUB" | "YOUTUBE" | "WEBSITE" | "TUTORIAL";
      required?: boolean;
    } & StoredFileInput,
  ) {
    const day = await curriculumRepository.day(dayId);
    if (!day) {
      throw ApiError.notFound("Day not found");
    }
    await programService.requireEditable(user, day.week.programId);
    if (!input.fileKey && !input.url) {
      throw ApiError.badRequest("Add a file or URL");
    }
    const sortOrder = await curriculumRepository.nextResourceOrder(dayId);
    await prisma.resource.create({
      data: {
        dayId,
        sortOrder,
        title: input.title,
        description: input.description ?? "",
        url: urlForStoredFile(input.fileKey, input.url ?? ""),
        kind: input.kind,
        required: input.required ?? false,
        ...storedFileData(input),
      },
    });
    return programService.getTreeForUser(user, day.week.programId);
  },

  async updateResource(
    user: AuthUser,
    id: string,
    input: Partial<{
      title: string;
      description: string;
      url: string;
      kind: "DOCUMENT" | "ARTICLE" | "GITHUB" | "YOUTUBE" | "WEBSITE" | "TUTORIAL";
      required: boolean;
    }> &
      StoredFileInput,
  ) {
    const resource = await curriculumRepository.resource(id);
    if (!resource) {
      throw ApiError.notFound("Resource not found");
    }
    await programService.requireEditable(user, resource.day.week.programId);
    const replacingFile = "fileKey" in input && input.fileKey !== resource.fileKey;
    await prisma.resource.update({
      where: { id },
      data: {
        ...("title" in input ? { title: input.title } : {}),
        ...("description" in input ? { description: input.description } : {}),
        ...("kind" in input ? { kind: input.kind } : {}),
        ...("required" in input ? { required: input.required } : {}),
        ...storedFileData(input),
        ...(replacingFile || "url" in input
          ? { url: urlForStoredFile(input.fileKey, input.url ?? resource.url) }
          : {}),
      },
    });
    if (replacingFile) {
      await deleteStorageObjectIfUnreferenced(resource.fileKey);
    }
    return programService.getTreeForUser(user, resource.day.week.programId);
  },

  async deleteResource(user: AuthUser, id: string) {
    const resource = await curriculumRepository.resource(id);
    if (!resource) {
      throw ApiError.notFound("Resource not found");
    }
    await programService.requireEditable(user, resource.day.week.programId);
    await unlinkAssignmentsFrom("RESOURCE", id);
    await prisma.resource.delete({ where: { id } });
    await deleteStorageObjectIfUnreferenced(resource.fileKey);
    return programService.getTreeForUser(user, resource.day.week.programId);
  },

  async addReel(
    user: AuthUser,
    dayId: string,
    input: { title: string; url?: string; durationSec?: number } & StoredFileInput,
  ) {
    const day = await curriculumRepository.day(dayId);
    if (!day) {
      throw ApiError.notFound("Day not found");
    }
    await programService.requireEditable(user, day.week.programId);
    if (!input.fileKey && !input.url) {
      throw ApiError.badRequest("Add a reel file or URL");
    }
    const sortOrder = await curriculumRepository.nextReelOrder(dayId);
    await prisma.reel.create({
      data: {
        dayId,
        sortOrder,
        title: input.title,
        url: urlForStoredFile(input.fileKey, input.url ?? ""),
        durationSec: input.durationSec ?? 0,
        ...storedFileData(input),
      },
    });
    return programService.getTreeForUser(user, day.week.programId);
  },

  async updateReel(
    user: AuthUser,
    id: string,
    input: Partial<{ title: string; url: string; durationSec: number }> & StoredFileInput,
  ) {
    const reel = await curriculumRepository.reel(id);
    if (!reel) {
      throw ApiError.notFound("Reel not found");
    }
    await programService.requireEditable(user, reel.day.week.programId);
    const replacingFile = "fileKey" in input && input.fileKey !== reel.fileKey;
    await prisma.reel.update({
      where: { id },
      data: {
        ...("title" in input ? { title: input.title } : {}),
        ...("durationSec" in input ? { durationSec: input.durationSec } : {}),
        ...storedFileData(input),
        ...(replacingFile || "url" in input ? { url: urlForStoredFile(input.fileKey, input.url ?? reel.url) } : {}),
      },
    });
    if (replacingFile) {
      await deleteStorageObjectIfUnreferenced(reel.fileKey);
    }
    return programService.getTreeForUser(user, reel.day.week.programId);
  },

  async deleteReel(user: AuthUser, id: string) {
    const reel = await curriculumRepository.reel(id);
    if (!reel) {
      throw ApiError.notFound("Reel not found");
    }
    await programService.requireEditable(user, reel.day.week.programId);
    await unlinkAssignmentsFrom("REEL", id);
    await prisma.reel.delete({ where: { id } });
    await deleteStorageObjectIfUnreferenced(reel.fileKey);
    return programService.getTreeForUser(user, reel.day.week.programId);
  },

  async addAssignment(
    user: AuthUser,
    dayId: string,
    input: {
      title: string;
      description?: string;
      instructions?: string;
      dueDate?: string | Date | null;
      maxScore?: number;
      status?: "DRAFT" | "PUBLISHED" | "CLOSED";
      allowFileUpload?: boolean;
      allowTextResponse?: boolean;
      allowLateSubmission?: boolean;
      allowResubmission?: boolean;
      maxAttempts?: number;
      allowedFileTypes?: string;
      maxFileSizeMb?: number;
      linkedItemType?: string | null;
      linkedItemId?: string | null;
    },
  ) {
    const day = await curriculumRepository.day(dayId);
    if (!day) {
      throw ApiError.notFound("Day not found");
    }
    await programService.requireEditable(user, day.week.programId);
    const linked = await resolveLinkedContent(dayId, input.linkedItemType, input.linkedItemId);
    const sortOrder = await curriculumRepository.nextAssignmentOrder(dayId);
    await prisma.assignment.create({
      data: {
        dayId,
        sortOrder,
        title: input.title,
        description: input.description ?? "",
        instructions: input.instructions ?? "",
        dueDate: parseDate(input.dueDate),
        maxScore: input.maxScore ?? 100,
        linkedItemType: linked.linkedItemType,
        linkedItemId: linked.linkedItemId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.allowFileUpload !== undefined ? { allowFileUpload: input.allowFileUpload } : {}),
        ...(input.allowTextResponse !== undefined ? { allowTextResponse: input.allowTextResponse } : {}),
        ...(input.allowLateSubmission !== undefined ? { allowLateSubmission: input.allowLateSubmission } : {}),
        ...(input.allowResubmission !== undefined ? { allowResubmission: input.allowResubmission } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.allowedFileTypes !== undefined ? { allowedFileTypes: input.allowedFileTypes } : {}),
        ...(input.maxFileSizeMb !== undefined ? { maxFileSizeMb: input.maxFileSizeMb } : {}),
      },
    });
    return programService.getTreeForUser(user, day.week.programId);
  },

  async updateAssignment(
    user: AuthUser,
    id: string,
    input: Partial<{
      title: string;
      description: string;
      instructions: string;
      dueDate: string | Date | null;
      maxScore: number;
      status: "DRAFT" | "PUBLISHED" | "CLOSED";
      allowFileUpload: boolean;
      allowTextResponse: boolean;
      allowLateSubmission: boolean;
      allowResubmission: boolean;
      maxAttempts: number;
      allowedFileTypes: string;
      maxFileSizeMb: number;
      linkedItemType: string | null;
      linkedItemId: string | null;
    }>,
  ) {
    const assignment = await curriculumRepository.assignment(id);
    if (!assignment) {
      throw ApiError.notFound("Assignment not found");
    }
    await programService.requireEditable(user, assignment.day.week.programId);
    const linked =
      "linkedItemType" in input || "linkedItemId" in input
        ? await resolveLinkedContent(
            assignment.dayId,
            input.linkedItemType ?? null,
            input.linkedItemId ?? null,
          )
        : null;
    await prisma.assignment.update({
      where: { id },
      data: {
        ...("title" in input ? { title: input.title } : {}),
        ...("description" in input ? { description: input.description } : {}),
        ...("instructions" in input ? { instructions: input.instructions } : {}),
        ...("maxScore" in input ? { maxScore: input.maxScore } : {}),
        ...("dueDate" in input ? { dueDate: parseDate(input.dueDate) } : {}),
        ...("status" in input ? { status: input.status } : {}),
        ...("allowFileUpload" in input ? { allowFileUpload: input.allowFileUpload } : {}),
        ...("allowTextResponse" in input ? { allowTextResponse: input.allowTextResponse } : {}),
        ...("allowLateSubmission" in input ? { allowLateSubmission: input.allowLateSubmission } : {}),
        ...("allowResubmission" in input ? { allowResubmission: input.allowResubmission } : {}),
        ...("maxAttempts" in input ? { maxAttempts: input.maxAttempts } : {}),
        ...("allowedFileTypes" in input ? { allowedFileTypes: input.allowedFileTypes } : {}),
        ...("maxFileSizeMb" in input ? { maxFileSizeMb: input.maxFileSizeMb } : {}),
        ...(linked ? { linkedItemType: linked.linkedItemType, linkedItemId: linked.linkedItemId } : {}),
      },
    });
    return programService.getTreeForUser(user, assignment.day.week.programId);
  },

  async deleteAssignment(user: AuthUser, id: string) {
    const assignment = await curriculumRepository.assignment(id);
    if (!assignment) {
      throw ApiError.notFound("Assignment not found");
    }
    await programService.requireEditable(user, assignment.day.week.programId);
    const keys = await collectStorageKeys({ assignmentId: id });
    await prisma.assignment.delete({ where: { id } });
    await purgeStorageKeys(keys);
    return programService.getTreeForUser(user, assignment.day.week.programId);
  },

  async addPracticeQuiz(user: AuthUser, dayId: string, input: QuizInput) {
    const day = await curriculumRepository.day(dayId);
    if (!day) {
      throw ApiError.notFound("Day not found");
    }
    await programService.requireEditable(user, day.week.programId);
    const existing = await prisma.quiz.findFirst({ where: { dayId, kind: QuizKind.PRACTICE_QUIZ } });
    if (existing) {
      throw ApiError.conflict("This day already has a practice quiz");
    }
    return this.createQuiz(user, day.week.programId, { ...input, kind: QuizKind.PRACTICE_QUIZ, dayId });
  },

  async addWeeklyQuiz(user: AuthUser, weekId: string, input: QuizInput) {
    const week = await curriculumRepository.week(weekId);
    if (!week) {
      throw ApiError.notFound("Week not found");
    }
    await programService.requireEditable(user, week.programId);
    const existing = await prisma.quiz.findFirst({ where: { weekId, kind: QuizKind.WEEKLY_QUIZ } });
    if (existing) {
      throw ApiError.conflict("This week already has a weekly quiz");
    }
    return this.createQuiz(user, week.programId, { ...input, kind: QuizKind.WEEKLY_QUIZ, weekId });
  },

  async addWeeklyExam(user: AuthUser, weekId: string, input: QuizInput) {
    const week = await curriculumRepository.week(weekId);
    if (!week) {
      throw ApiError.notFound("Week not found");
    }
    await programService.requireEditable(user, week.programId);
    const existing = await prisma.quiz.findFirst({ where: { weekId, kind: QuizKind.WEEKLY_EXAM } });
    if (existing) {
      throw ApiError.conflict("This week already has a weekly exam");
    }
    return this.createQuiz(user, week.programId, { ...input, kind: QuizKind.WEEKLY_EXAM, weekId });
  },

  async addFinalExam(user: AuthUser, programId: string, input: QuizInput) {
    await programService.requireEditable(user, programId);
    const existing = await prisma.quiz.findFirst({ where: { programId, kind: QuizKind.FINAL_EXAM } });
    if (existing) {
      throw ApiError.conflict("This program already has a final exam");
    }
    return this.createQuiz(user, programId, { ...input, kind: QuizKind.FINAL_EXAM, programId });
  },

  async addMilestoneExam(user: AuthUser, milestoneId: string, input: QuizInput) {
    const milestone = await curriculumRepository.milestone(milestoneId);
    if (!milestone) {
      throw ApiError.notFound("Milestone not found");
    }
    await programService.requireEditable(user, milestone.programId);
    const existing = await prisma.quiz.findFirst({ where: { milestoneId } });
    if (existing) {
      throw ApiError.conflict("This milestone already has an exam");
    }
    return this.createQuiz(user, milestone.programId, {
      ...input,
      kind: QuizKind.MILESTONE_EXAM,
      milestoneId,
    });
  },

  async createQuiz(
    user: AuthUser,
    programId: string,
    input: QuizInput & {
      kind: QuizKind;
      dayId?: string;
      weekId?: string;
      milestoneId?: string;
      programId?: string;
    },
  ) {
    assertQuestions(input.questions);
    if (input.questions?.length) {
      await assertDrawCount(input.questionDrawCount, input.questions.length);
    }
    const quiz = await prisma.quiz.create({
      data: {
        kind: input.kind,
        title: input.title,
        description: input.description ?? "",
        passingScore: input.passingScore ?? 70,
        timeLimitMin: input.timeLimitMin,
        maxAttempts: input.maxAttempts,
        randomized: input.randomized ?? false,
        questionDrawCount: input.questionDrawCount ?? null,
        ...quizRevealData(input),
        dayId: input.dayId,
        weekId: input.weekId,
        milestoneId: input.milestoneId,
        programId: input.kind === QuizKind.FINAL_EXAM ? programId : input.programId,
      },
    });

    if (input.questions?.length) {
      await createQuestions(quiz.id, input.questions);
    }

    return programService.getTreeForUser(user, programId);
  },

  async updateQuiz(user: AuthUser, quizId: string, input: QuizInput) {
    const quiz = await curriculumRepository.quiz(quizId);
    if (!quiz) {
      throw ApiError.notFound("Quiz not found");
    }
    const programId =
      quiz.programId ??
      quiz.milestone?.programId ??
      quiz.week?.programId ??
      quiz.day?.week.programId;
    if (!programId) {
      throw ApiError.notFound("Quiz not found");
    }
    await programService.requireEditable(user, programId);
    assertQuestions(input.questions);
    const bankSize = input.questions
      ? input.questions.length
      : await prisma.question.count({ where: { quizId } });
    await assertDrawCount(input.questionDrawCount, bankSize);
    await prisma.quiz.update({
      where: { id: quizId },
      data: {
        title: input.title,
        description: input.description,
        passingScore: input.passingScore,
        timeLimitMin: input.timeLimitMin,
        maxAttempts: input.maxAttempts,
        randomized: input.randomized,
        questionDrawCount: input.questionDrawCount,
        ...quizRevealData(input, { revealMode: quiz.revealMode, revealAt: quiz.revealAt }),
      },
    });
    if (input.questions) {
      await prisma.question.deleteMany({ where: { quizId } });
      await createQuestions(quizId, input.questions);
    }
    return programService.getTreeForUser(user, programId);
  },

  async deleteQuiz(user: AuthUser, quizId: string) {
    const quiz = await curriculumRepository.quiz(quizId);
    if (!quiz) {
      throw ApiError.notFound("Quiz not found");
    }
    const programId =
      quiz.programId ??
      quiz.milestone?.programId ??
      quiz.week?.programId ??
      quiz.day?.week.programId;
    if (!programId) {
      throw ApiError.notFound("Quiz not found");
    }
    await programService.requireEditable(user, programId);
    await prisma.quiz.delete({ where: { id: quizId } });
    return programService.getTreeForUser(user, programId);
  },

  async addMilestone(user: AuthUser, programId: string, input: { title: string; afterWeekIndex: number }) {
    await programService.requireEditable(user, programId);
    const sortOrder = await curriculumRepository.nextMilestoneOrder(programId);
    await prisma.milestone.create({
      data: {
        programId,
        sortOrder,
        title: input.title,
        afterWeekIndex: input.afterWeekIndex,
      },
    });
    return programService.getTreeForUser(user, programId);
  },

  async updateMilestone(user: AuthUser, id: string, input: Partial<{ title: string; afterWeekIndex: number }>) {
    const milestone = await curriculumRepository.milestone(id);
    if (!milestone) {
      throw ApiError.notFound("Milestone not found");
    }
    await programService.requireEditable(user, milestone.programId);
    await prisma.milestone.update({ where: { id }, data: input });
    return programService.getTreeForUser(user, milestone.programId);
  },

  async deleteMilestone(user: AuthUser, id: string) {
    const milestone = await curriculumRepository.milestone(id);
    if (!milestone) {
      throw ApiError.notFound("Milestone not found");
    }
    await programService.requireEditable(user, milestone.programId);
    await prisma.milestone.delete({ where: { id } });
    return programService.getTreeForUser(user, milestone.programId);
  },

  async addRequirement(
    user: AuthUser,
    milestoneId: string,
    input: { label: string; kind?: "WEEKS_COMPLETED" | "ASSESSMENTS_PASSED" | "ASSIGNMENTS_COMPLETE" | "ATTENDANCE" | "CUSTOM"; targetCount?: number },
  ) {
    const milestone = await curriculumRepository.milestone(milestoneId);
    if (!milestone) {
      throw ApiError.notFound("Milestone not found");
    }
    await programService.requireEditable(user, milestone.programId);
    const sortOrder = await curriculumRepository.nextRequirementOrder(milestoneId);
    await prisma.milestoneRequirement.create({
      data: {
        milestoneId,
        sortOrder,
        label: input.label,
        kind: input.kind ?? "CUSTOM",
        targetCount: input.targetCount ?? (input.kind === "ATTENDANCE" ? 80 : 1),
      },
    });
    return programService.getTreeForUser(user, milestone.programId);
  },

  async deleteRequirement(user: AuthUser, id: string) {
    const requirement = await curriculumRepository.requirement(id);
    if (!requirement) {
      throw ApiError.notFound("Requirement not found");
    }
    await programService.requireEditable(user, requirement.milestone.programId);
    await prisma.milestoneRequirement.delete({ where: { id } });
    return programService.getTreeForUser(user, requirement.milestone.programId);
  },

  async addSession(user: AuthUser, weekId: string, input: SessionInput & { title: string }) {
    const week = await curriculumRepository.week(weekId);
    if (!week) {
      throw ApiError.notFound("Week not found");
    }
    await programService.requireTrainerOnProgram(user, week.programId);
    const sortOrder = await curriculumRepository.nextSessionOrder(weekId);
    const times = sessionTimes(input);
    await prisma.trainingSession.create({
      data: {
        weekId,
        sortOrder,
        title: input.title,
        description: input.description ?? "",
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        meetingUrl: times.meetingUrl ?? null,
      },
    });
    return programService.getTreeForUser(user, week.programId);
  },

  async updateSession(user: AuthUser, id: string, input: SessionInput) {
    const session = await curriculumRepository.session(id);
    if (!session) {
      throw ApiError.notFound("Training session not found");
    }
    await programService.requireTrainerOnProgram(user, session.week.programId);
    const hasSchedule =
      input.startsAt !== undefined ||
      input.endsAt !== undefined ||
      input.date !== undefined ||
      input.startTime !== undefined ||
      input.endTime !== undefined;
    const times = hasSchedule ? sessionTimes({ ...input, startsAt: input.startsAt ?? session.startsAt }) : null;
    await prisma.trainingSession.update({
      where: { id },
      data: {
        ...("title" in input && input.title !== undefined ? { title: input.title } : {}),
        ...("description" in input && input.description !== undefined ? { description: input.description } : {}),
        ...(input.meetingLink !== undefined || input.meetingUrl !== undefined
          ? { meetingUrl: input.meetingLink !== undefined ? input.meetingLink : input.meetingUrl }
          : {}),
        ...(times ? { startsAt: times.startsAt, endsAt: times.endsAt } : {}),
      },
    });
    return programService.getTreeForUser(user, session.week.programId);
  },

  async deleteSession(user: AuthUser, id: string) {
    const session = await curriculumRepository.session(id);
    if (!session) {
      throw ApiError.notFound("Training session not found");
    }
    await programService.requireTrainerOnProgram(user, session.week.programId);
    await prisma.trainingSession.delete({ where: { id } });
    return programService.getTreeForUser(user, session.week.programId);
  },
};
