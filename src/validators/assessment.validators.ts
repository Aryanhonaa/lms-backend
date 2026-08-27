import { z } from "zod";

export const submitAttemptSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      optionIds: z.array(z.string().uuid()),
    }),
  ),
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
