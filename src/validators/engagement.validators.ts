import { z } from "zod";

export const submitFeedbackSchema = z.object({
  targetKind: z.enum(["COURSE", "TRAINER", "SESSION", "MATERIAL"]),
  targetId: z.string().uuid(),
  programId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export const moderateFeedbackSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "HIDDEN"]),
});

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
  audience: z.enum(["EVERYONE", "TRAINERS", "TRAINEES", "PROGRAM", "TRAINEES_SELECTED"]),
  programId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  traineeIds: z.array(z.string().uuid()).max(200).optional(),
});
