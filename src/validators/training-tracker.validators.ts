import { z } from "zod";

export const createNhtBatchSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  batchNumber: z.number().int().min(1).max(99),
  process: z.enum(["VOICE_SALES", "NON_VOICE_SALES_SUPPORT"]),
  programId: z.string().uuid().optional(),
  programIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  trainingStartDate: z.string().min(8),
  targetCompletionDate: z.string().min(8),
  salesTrainerId: z.string().uuid(),
  filesTrainerId: z.string().uuid().optional().nullable(),
}).refine((value) => Boolean(value.programIds?.length || value.programId), {
  message: "Select at least one approved course",
  path: ["programIds"],
});

export const updateNhtBatchSchema = z.object({
  programId: z.string().uuid().optional(),
  programIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  targetCompletionDate: z.string().min(8).optional(),
  actualCompletionDate: z.string().min(8).optional().nullable(),
  salesTrainerId: z.string().uuid().optional(),
  filesTrainerId: z.string().uuid().optional().nullable(),
  status: z.enum(["ONGOING", "COMPLETED"]).optional(),
  day1Hc: z.number().int().min(0).max(500).optional(),
  day7Hc: z.number().int().min(0).max(500).optional().nullable(),
});

export const addNhtTraineeSchema = z.object({
  userId: z.string().uuid(),
  joiningDate: z.string().min(8),
  team: z.string().max(120).optional(),
  supervisorName: z.string().max(120).optional(),
  trainerId: z.string().uuid().optional().nullable(),
});

export const addStandaloneTraineeSchema = z.object({
  userId: z.string().uuid(),
  process: z.enum(["VOICE_SALES", "NON_VOICE_SALES_SUPPORT"]),
  joiningDate: z.string().min(8),
  team: z.string().max(120).optional(),
  supervisorName: z.string().max(120).optional(),
  trainerId: z.string().uuid().optional().nullable(),
});

export const attritionSchema = z.object({
  kind: z.enum(["HR", "TRAINING"]),
  date: z.string().min(8),
  reason: z.string().min(1).max(500),
  remarks: z.string().max(1000).optional(),
});

export const examResultSchema = z.object({
  appeared: z.boolean(),
  passed: z.boolean().optional(),
  examDate: z.string().min(8).optional(),
  remarks: z.string().max(1000).optional(),
});

export const handoverSchema = z.object({
  handoverDate: z.string().min(8),
  team: z.string().min(1).max(120),
  supervisorName: z.string().max(120).optional(),
  remarks: z.string().max(1000).optional(),
});

export const lcaAuditSchema = z.object({
  traineeId: z.string().uuid(),
  weekNumber: z.number().int().min(1).max(8),
  auditDate: z.string().min(8),
  auditType: z.enum(["CALL", "CHAT"]),
  score: z.number().min(0).max(100),
  remarks: z.string().max(1000).optional(),
  isReAudit: z.boolean().optional(),
});

export const tniSupportSchema = z.object({
  identifiedGap: z.string().min(1).max(1000),
  trainerId: z.string().uuid().optional(),
  supportPlan: z.string().min(1).max(2000),
  supportStartDate: z.string().min(8),
  reviewDate: z.string().min(8),
  trainerRemarks: z.string().max(1000).optional(),
});

export const tniDecisionSchema = z.object({
  decision: z.enum(["CLEARED", "CONTINUE_MONITORING", "INTERNAL_TRANSFER", "TERMINATED"]),
  confirmTermination: z.boolean().optional(),
  reason: z.string().max(1000).optional(),
});
