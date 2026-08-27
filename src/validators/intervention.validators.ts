import { z } from "zod";

const optionalDate = z.union([z.iso.datetime(), z.iso.date()]).optional().nullable();

export const interventionSettingsSchema = z.object({
  progressThreshold: z.number().min(0).max(100).optional(),
  examScoreThreshold: z.number().min(0).max(100).optional(),
});

export const updateInterventionSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "RESOLVED"]),
});

export const assignRequirementSchema = z.object({
  enrollmentId: z.string().uuid(),
  interventionFlagId: z.string().uuid().optional().nullable(),
  type: z.enum(["VIDEO", "READING", "QUIZ", "ASSIGNMENT", "SESSION", "EXAM_RETRY", "CUSTOM"]),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  trainerMessage: z.string().optional(),
  reason: z.string().optional(),
  deadline: optionalDate,
});
