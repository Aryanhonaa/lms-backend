import { z } from "zod";

const optionalDate = z.union([z.iso.datetime(), z.iso.date()]).optional().nullable();

export const createProgramSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional().default(""),
  category: z.string().trim().optional().default("General"),
  difficulty: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional().default("BEGINNER"),
  durationWeeks: z.number().int().positive().optional().default(4),
  trainingMode: z.enum(["SCHEDULED", "PROGRESSION"]).optional().default("PROGRESSION"),
  startDate: optionalDate,
  endDate: optionalDate,
  learningObjectives: z.array(z.string()).optional(),
  prerequisites: z.array(z.string()).optional(),
  progressThreshold: z.number().min(0).max(100).optional(),
  examScoreThreshold: z.number().min(0).max(100).optional(),
});

export const updateProgramSchema = createProgramSchema.partial();

export const rejectProgramSchema = z.object({
  reason: z.string().trim().min(1),
});

export const enrollTraineesSchema = z.object({
  traineeIds: z.array(z.string().uuid()).min(1).max(25),
});

export const enrollIntoProgramSchema = enrollTraineesSchema.extend({
  batchId: z.string().uuid(),
});

export const batchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
});

export const weekSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
});

export const daySchema = z.object({
  title: z.string().trim().min(1),
});

export const lessonSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  durationMin: z.number().int().nonnegative().optional(),
  required: z.boolean().optional(),
});

const storedFileFields = {
  fileKey: z.string().trim().min(1).max(512).nullable().optional(),
  fileName: z.string().trim().min(1).max(255).nullable().optional(),
  mimeType: z.string().trim().min(1).max(180).nullable().optional(),
  fileSize: z.number().int().nonnegative().nullable().optional(),
};

export const videoSchema = z
  .object({
    title: z.string().trim().min(1),
    source: z.enum(["YOUTUBE", "UPLOADED", "EXTERNAL"]),
    url: z.string().trim().min(1).optional(),
    durationMin: z.number().int().nonnegative().optional(),
    ...storedFileFields,
  })
  .refine((value) => Boolean(value.url || value.fileKey), {
    message: "Add a video file or URL",
  });

export const updateVideoSchema = z.object({
  title: z.string().trim().min(1).optional(),
  source: z.enum(["YOUTUBE", "UPLOADED", "EXTERNAL"]).optional(),
  url: z.string().trim().min(1).optional(),
  durationMin: z.number().int().nonnegative().optional(),
  ...storedFileFields,
});

export const resourceSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().optional(),
    url: z.string().trim().min(1).optional(),
    kind: z.enum(["DOCUMENT", "ARTICLE", "GITHUB", "YOUTUBE", "WEBSITE", "TUTORIAL"]),
    required: z.boolean().optional(),
    ...storedFileFields,
  })
  .refine((value) => Boolean(value.url || value.fileKey), {
    message: "Add a file or URL",
  });

export const updateResourceSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  url: z.string().trim().min(1).optional(),
  kind: z.enum(["DOCUMENT", "ARTICLE", "GITHUB", "YOUTUBE", "WEBSITE", "TUTORIAL"]).optional(),
  required: z.boolean().optional(),
  ...storedFileFields,
});

export const reelSchema = z
  .object({
    title: z.string().trim().min(1),
    url: z.string().trim().min(1).optional(),
    durationSec: z.number().int().nonnegative().optional(),
    ...storedFileFields,
  })
  .refine((value) => Boolean(value.url || value.fileKey), {
    message: "Add a reel file or URL",
  });

export const updateReelSchema = z.object({
  title: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
  durationSec: z.number().int().nonnegative().optional(),
  ...storedFileFields,
});

export const uploadTicketSchema = z.object({
  purpose: z.enum(["VIDEO", "REEL", "RESOURCE", "LESSON_ATTACHMENT", "ASSIGNMENT_ATTACHMENT"]),
  dayId: z.string().uuid(),
  contentId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(180),
  fileSize: z.number().int().positive(),
});

export const confirmUploadSchema = z.object({
  key: z.string().trim().min(1).max(512),
  dayId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(180),
  fileSize: z.number().int().nonnegative(),
});

export const assignmentSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  instructions: z.string().optional(),
  dueDate: optionalDate,
  maxScore: z.number().int().positive().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
  allowFileUpload: z.boolean().optional(),
  allowTextResponse: z.boolean().optional(),
  allowLateSubmission: z.boolean().optional(),
  allowResubmission: z.boolean().optional(),
  maxAttempts: z.number().int().positive().max(20).optional(),
  allowedFileTypes: z.string().optional(),
  maxFileSizeMb: z.number().int().positive().max(100).optional(),
  linkedItemType: z.enum(["LESSON", "VIDEO", "RESOURCE", "REEL"]).optional().nullable(),
  linkedItemId: z.string().uuid().optional().nullable(),
});

const questionSchema = z.object({
  prompt: z.string().trim().min(1),
  points: z.number().int().positive().optional(),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        isCorrect: z.boolean(),
      }),
    )
    .min(2),
});

export const quizSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().optional(),
    passingScore: z.number().int().min(0).max(100).optional(),
    timeLimitMin: z.number().int().positive().optional().nullable(),
    maxAttempts: z.number().int().positive().optional().nullable(),
    randomized: z.boolean().optional(),
    revealMode: z.enum(["HIDDEN", "IMMEDIATE", "SCHEDULED"]).optional(),
    revealAt: z
      .union([
        z.iso.datetime(),
        z.iso.date(),
        z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/),
      ])
      .optional()
      .nullable(),
    questions: z.array(questionSchema).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.revealMode === "SCHEDULED" && !value.revealAt) {
      ctx.addIssue({
        code: "custom",
        message: "Choose when answers become visible.",
        path: ["revealAt"],
      });
    }
  });

export const milestoneSchema = z.object({
  title: z.string().trim().min(1),
  afterWeekIndex: z.number().int().nonnegative(),
});

export const requirementSchema = z.object({
  label: z.string().trim().min(1),
  kind: z.enum(["WEEKS_COMPLETED", "ASSESSMENTS_PASSED", "ASSIGNMENTS_COMPLETE", "ATTENDANCE", "CUSTOM"]).optional(),
  targetCount: z.number().int().positive().optional(),
});

const sessionFields = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  date: z.iso.date().optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
    .optional(),
  startsAt: z.union([z.iso.datetime(), z.iso.date()]).optional(),
  endsAt: z.union([z.iso.datetime(), z.iso.date()]).optional(),
  meetingLink: z.string().trim().optional().nullable(),
  meetingUrl: z.string().trim().optional().nullable(),
});

export const sessionSchema = sessionFields.refine((value) => Boolean(value.startsAt || value.date), {
  message: "Provide date or startsAt",
});

export const updateSessionSchema = sessionFields.partial();
