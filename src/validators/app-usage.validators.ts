import { z } from "zod";

export const usageHeartbeatSchema = z
  .object({
    programId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
  })
  .strict();

export const usagePeriodSchema = z.enum(["daily", "weekly", "monthly"]);

export type UsageHeartbeatInput = z.infer<typeof usageHeartbeatSchema>;
export type UsagePeriod = z.infer<typeof usagePeriodSchema>;
