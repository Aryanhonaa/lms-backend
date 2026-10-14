import { randomUUID } from "node:crypto";
import { ProgramStatus, QuizRevealMode, Role, type Prisma } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { fileStorage } from "../storage";
import type { UploadPurpose } from "../storage/file-types";
import { buildObjectKey } from "../storage/object-keys";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { logger } from "../utils/logger";
import { folderForPurpose } from "./file.service";
import { programService } from "./program.service";

const DUPLICATE_TIMEOUT_MS = 60_000;
const COPY_CONCURRENCY = 4;

const QUIZ_INCLUDE = {
  questions: {
    orderBy: { sortOrder: "asc" },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  },
} satisfies Prisma.QuizInclude;

const SOURCE_INCLUDE = {
  weeks: {
    orderBy: { sortOrder: "asc" },
    include: {
      quizzes: { where: { dayId: null }, include: QUIZ_INCLUDE },
      days: {
        orderBy: { sortOrder: "asc" },
        include: {
          lessons: { include: { attachments: true } },
          videos: true,
          resources: true,
          reels: true,
          assignments: { include: { attachments: true } },
          quizzes: { include: QUIZ_INCLUDE },
        },
      },
    },
  },
  milestones: { include: { requirements: true, exam: { include: QUIZ_INCLUDE } } },
  quizzes: { where: { dayId: null, weekId: null, milestoneId: null }, include: QUIZ_INCLUDE },
} satisfies Prisma.ProgramInclude;

type SourceQuiz = Prisma.QuizGetPayload<{ include: typeof QUIZ_INCLUDE }>;

type FileCopy = { from: string; to: string; label: string };

type Rows = {
  weeks: Prisma.WeekCreateManyInput[];
  days: Prisma.DayCreateManyInput[];
  lessons: Prisma.LessonCreateManyInput[];
  videos: Prisma.VideoCreateManyInput[];
  resources: Prisma.ResourceCreateManyInput[];
  reels: Prisma.ReelCreateManyInput[];
  assignments: Prisma.AssignmentCreateManyInput[];
  attachments: Prisma.ContentAttachmentCreateManyInput[];
  milestones: Prisma.MilestoneCreateManyInput[];
  requirements: Prisma.MilestoneRequirementCreateManyInput[];
  quizzes: Prisma.QuizCreateManyInput[];
  questions: Prisma.QuestionCreateManyInput[];
  options: Prisma.QuestionOptionCreateManyInput[];
};

/** Uploaded media stores `storage:<key>` in its url column; legacy rows may embed the key in a path. */
function copiedUrl(url: string, oldKey: string, newKey: string): string {
  return url.split(oldKey).join(newKey);
}

async function copyFiles(copies: FileCopy[]): Promise<string[]> {
  const done: string[] = [];
  for (let index = 0; index < copies.length; index += COPY_CONCURRENCY) {
    const batch = copies.slice(index, index + COPY_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((copy) => fileStorage.copy(copy.from, copy.to)));
    results.forEach((result, offset) => {
      if (result.status === "fulfilled") {
        done.push(batch[offset].to);
      }
    });
    const failedIndex = results.findIndex((result) => result.status === "rejected");
    if (failedIndex !== -1) {
      const failed = results[failedIndex] as PromiseRejectedResult;
      logger.warn("Course duplicate: file copy failed", failed.reason);
      await removeFiles(done);
      throw new ApiError(
        502,
        `We couldn't copy the file for "${batch[failedIndex].label}". Check that it still opens in the original course, then try again.`,
        "STORAGE_UNAVAILABLE",
      );
    }
  }
  return done;
}

async function removeFiles(keys: string[]) {
  for (const key of keys) {
    await fileStorage.delete(key).catch(() => undefined);
  }
}

export const programDuplicateService = {
  /** Copies a course's curriculum into a new draft owned by the trainer. Learner data is never copied. */
  async duplicate(user: AuthUser, programId: string, input: { title?: string }) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden("Only trainers can duplicate a course.");
    }
    await programService.requireTrainerOnProgram(user, programId);

    const source = await prisma.program.findUnique({ where: { id: programId }, include: SOURCE_INCLUDE });
    if (!source) {
      throw ApiError.notFound("Program not found");
    }

    const newProgramId = randomUUID();
    const rows: Rows = {
      weeks: [],
      days: [],
      lessons: [],
      videos: [],
      resources: [],
      reels: [],
      assignments: [],
      attachments: [],
      milestones: [],
      requirements: [],
      quizzes: [],
      questions: [],
      options: [],
    };
    const copies: FileCopy[] = [];
    const newIds = new Map<string, string>();

    function copyFile(
      fromKey: string,
      purpose: UploadPurpose,
      scope: { weekId: string; dayId: string; contentId?: string },
      fileName: string | null,
      mimeType: string | null,
      label: string,
    ): string {
      const to = buildObjectKey(
        folderForPurpose(purpose, { programId: newProgramId, ...scope }),
        fileName ?? "file",
        mimeType ?? "application/octet-stream",
      );
      copies.push({ from: fromKey, to, label });
      return to;
    }

    function addQuiz(quiz: SourceQuiz, parent: { dayId?: string; weekId?: string; milestoneId?: string; programId?: string }) {
      const quizId = randomUUID();
      rows.quizzes.push({
        id: quizId,
        kind: quiz.kind,
        title: quiz.title,
        description: quiz.description,
        passingScore: quiz.passingScore,
        timeLimitMin: quiz.timeLimitMin,
        maxAttempts: quiz.maxAttempts,
        randomized: quiz.randomized,
        questionDrawCount: quiz.questionDrawCount,
        revealMode: quiz.revealMode === QuizRevealMode.SCHEDULED ? QuizRevealMode.HIDDEN : quiz.revealMode,
        revealAt: null,
        dayId: parent.dayId ?? null,
        weekId: parent.weekId ?? null,
        milestoneId: parent.milestoneId ?? null,
        programId: parent.programId ?? null,
      });
      for (const question of quiz.questions) {
        const questionId = randomUUID();
        rows.questions.push({
          id: questionId,
          quizId,
          sortOrder: question.sortOrder,
          type: question.type,
          prompt: question.prompt,
          points: question.points,
          modelAnswer: question.modelAnswer,
        });
        for (const option of question.options) {
          rows.options.push({
            questionId,
            sortOrder: option.sortOrder,
            label: option.label,
            isCorrect: option.isCorrect,
          });
        }
      }
    }

    for (const week of source.weeks) {
      const weekId = randomUUID();
      rows.weeks.push({
        id: weekId,
        programId: newProgramId,
        sortOrder: week.sortOrder,
        title: week.title,
        description: week.description,
        objectives: week.objectives,
      });
      for (const quiz of week.quizzes) {
        addQuiz(quiz, { weekId });
      }

      for (const day of week.days) {
        const dayId = randomUUID();
        const scope = { weekId, dayId };
        rows.days.push({ id: dayId, weekId, sortOrder: day.sortOrder, title: day.title });

        for (const lesson of day.lessons) {
          const lessonId = randomUUID();
          newIds.set(lesson.id, lessonId);
          rows.lessons.push({
            id: lessonId,
            dayId,
            sortOrder: lesson.sortOrder,
            title: lesson.title,
            description: lesson.description,
            durationMin: lesson.durationMin,
            required: lesson.required,
          });
          for (const attachment of lesson.attachments) {
            rows.attachments.push({
              lessonId,
              sortOrder: attachment.sortOrder,
              title: attachment.title,
              fileName: attachment.fileName,
              fileKey: copyFile(
                attachment.fileKey,
                "LESSON_ATTACHMENT",
                { ...scope, contentId: lessonId },
                attachment.fileName,
                attachment.mimeType,
                attachment.title || attachment.fileName,
              ),
              mimeType: attachment.mimeType,
              fileSize: attachment.fileSize,
              storageProvider: fileStorage.provider,
              uploadedByUserId: user.id,
            });
          }
        }

        for (const video of day.videos) {
          const videoId = randomUUID();
          newIds.set(video.id, videoId);
          const fileKey = video.fileKey
            ? copyFile(video.fileKey, "VIDEO", scope, video.fileName, video.mimeType, video.title)
            : null;
          rows.videos.push({
            id: videoId,
            dayId,
            sortOrder: video.sortOrder,
            title: video.title,
            source: video.source,
            url: video.fileKey && fileKey ? copiedUrl(video.url, video.fileKey, fileKey) : video.url,
            durationMin: video.durationMin,
            fileKey,
            fileName: video.fileName,
            mimeType: video.mimeType,
            fileSize: video.fileSize,
            storageProvider: fileKey ? fileStorage.provider : video.storageProvider,
          });
        }

        for (const resource of day.resources) {
          const resourceId = randomUUID();
          newIds.set(resource.id, resourceId);
          const fileKey = resource.fileKey
            ? copyFile(
                resource.fileKey,
                resource.kind === "CALL_RECORDING" ? "CALL_RECORDING" : "RESOURCE",
                scope,
                resource.fileName,
                resource.mimeType,
                resource.title,
              )
            : null;
          rows.resources.push({
            id: resourceId,
            dayId,
            sortOrder: resource.sortOrder,
            title: resource.title,
            description: resource.description,
            url: resource.fileKey && fileKey ? copiedUrl(resource.url, resource.fileKey, fileKey) : resource.url,
            kind: resource.kind,
            required: resource.required,
            fileKey,
            fileName: resource.fileName,
            mimeType: resource.mimeType,
            fileSize: resource.fileSize,
            storageProvider: fileKey ? fileStorage.provider : resource.storageProvider,
          });
        }

        for (const reel of day.reels) {
          const reelId = randomUUID();
          newIds.set(reel.id, reelId);
          const fileKey = reel.fileKey
            ? copyFile(reel.fileKey, "REEL", scope, reel.fileName, reel.mimeType, reel.title)
            : null;
          rows.reels.push({
            id: reelId,
            dayId,
            sortOrder: reel.sortOrder,
            title: reel.title,
            url: reel.fileKey && fileKey ? copiedUrl(reel.url, reel.fileKey, fileKey) : reel.url,
            durationSec: reel.durationSec,
            fileKey,
            fileName: reel.fileName,
            mimeType: reel.mimeType,
            fileSize: reel.fileSize,
            storageProvider: fileKey ? fileStorage.provider : reel.storageProvider,
          });
        }

        for (const assignment of day.assignments) {
          const assignmentId = randomUUID();
          const linkedItemId = assignment.linkedItemId ? newIds.get(assignment.linkedItemId) ?? null : null;
          rows.assignments.push({
            id: assignmentId,
            dayId,
            sortOrder: assignment.sortOrder,
            title: assignment.title,
            description: assignment.description,
            instructions: assignment.instructions,
            dueDate: null,
            maxScore: assignment.maxScore,
            status: assignment.status,
            allowFileUpload: assignment.allowFileUpload,
            allowTextResponse: assignment.allowTextResponse,
            allowLateSubmission: assignment.allowLateSubmission,
            allowResubmission: assignment.allowResubmission,
            maxAttempts: assignment.maxAttempts,
            allowedFileTypes: assignment.allowedFileTypes,
            maxFileSizeMb: assignment.maxFileSizeMb,
            linkedItemType: linkedItemId ? assignment.linkedItemType : null,
            linkedItemId,
          });
          for (const attachment of assignment.attachments) {
            rows.attachments.push({
              assignmentId,
              sortOrder: attachment.sortOrder,
              title: attachment.title,
              fileName: attachment.fileName,
              fileKey: copyFile(
                attachment.fileKey,
                "ASSIGNMENT_ATTACHMENT",
                { ...scope, contentId: assignmentId },
                attachment.fileName,
                attachment.mimeType,
                attachment.title || attachment.fileName,
              ),
              mimeType: attachment.mimeType,
              fileSize: attachment.fileSize,
              storageProvider: fileStorage.provider,
              uploadedByUserId: user.id,
            });
          }
        }

        for (const quiz of day.quizzes) {
          addQuiz(quiz, { dayId });
        }
      }
    }

    for (const milestone of source.milestones) {
      const milestoneId = randomUUID();
      rows.milestones.push({
        id: milestoneId,
        programId: newProgramId,
        sortOrder: milestone.sortOrder,
        title: milestone.title,
        afterWeekIndex: milestone.afterWeekIndex,
      });
      for (const requirement of milestone.requirements) {
        rows.requirements.push({
          milestoneId,
          sortOrder: requirement.sortOrder,
          kind: requirement.kind,
          label: requirement.label,
          targetCount: requirement.targetCount,
        });
      }
      if (milestone.exam) {
        addQuiz(milestone.exam, { milestoneId });
      }
    }

    for (const quiz of source.quizzes) {
      addQuiz(quiz, { programId: newProgramId });
    }

    const copiedKeys = await copyFiles(copies);

    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.program.create({
            data: {
              id: newProgramId,
              title: input.title?.trim() || `${source.title} (copy)`,
              description: source.description,
              category: source.category,
              difficulty: source.difficulty,
              durationWeeks: source.durationWeeks,
              trainingMode: source.trainingMode,
              learningObjectives: source.learningObjectives,
              prerequisites: source.prerequisites,
              progressThreshold: source.progressThreshold,
              examScoreThreshold: source.examScoreThreshold,
              status: ProgramStatus.DRAFT,
              createdByUserId: user.id,
            },
          });
          await tx.programTrainer.create({ data: { programId: newProgramId, userId: user.id, role: "OWNER" } });
          if (rows.weeks.length) await tx.week.createMany({ data: rows.weeks });
          if (rows.days.length) await tx.day.createMany({ data: rows.days });
          if (rows.lessons.length) await tx.lesson.createMany({ data: rows.lessons });
          if (rows.videos.length) await tx.video.createMany({ data: rows.videos });
          if (rows.resources.length) await tx.resource.createMany({ data: rows.resources });
          if (rows.reels.length) await tx.reel.createMany({ data: rows.reels });
          if (rows.assignments.length) await tx.assignment.createMany({ data: rows.assignments });
          if (rows.attachments.length) await tx.contentAttachment.createMany({ data: rows.attachments });
          if (rows.milestones.length) await tx.milestone.createMany({ data: rows.milestones });
          if (rows.requirements.length) await tx.milestoneRequirement.createMany({ data: rows.requirements });
          if (rows.quizzes.length) await tx.quiz.createMany({ data: rows.quizzes });
          if (rows.questions.length) await tx.question.createMany({ data: rows.questions });
          if (rows.options.length) await tx.questionOption.createMany({ data: rows.options });
        },
        { timeout: DUPLICATE_TIMEOUT_MS },
      );
    } catch (error) {
      await removeFiles(copiedKeys);
      throw error;
    }

    return programService.getTreeForUser(user, newProgramId);
  },
};
