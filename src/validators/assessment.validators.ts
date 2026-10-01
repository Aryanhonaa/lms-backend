import { z } from "zod";

export const submitAttemptSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      optionIds: z.array(z.string().uuid()).default([]),
      text: z.string().max(10000).optional(),
    }),
  ),
});

export const gradeAttemptSchema = z.object({
  grades: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        pointsAwarded: z.number().int().min(0).max(100),
        comment: z.string().max(2000).optional(),
      }),
    )
    .min(1),
});

export const assignmentSubmissionSchema = z.object({
  body: z.string().optional(),
  submit: z.boolean().optional(),
  batchId: z.string().uuid().optional(),
});

export const reviewSubmissionSchema = z.object({
  status: z.enum(["GRADED", "CHANGES_REQUESTED", "COMPLETED"]),
  score: z.number().int().nonnegative().optional().nullable(),
  comment: z.string().optional(),
});
