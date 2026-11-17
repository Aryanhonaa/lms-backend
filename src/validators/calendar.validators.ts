import { z } from "zod";

export const createCalendarActivitySchema = z
  .object({
    programId: z.string().uuid(),
    batchId: z.string().uuid(),
    audience: z.enum(["TRAINEE", "BATCH"]),
    traineeUserId: z.string().uuid().optional().nullable(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional().default(""),
    date: z.iso.date(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Time must be HH:MM")
      .optional()
      .default("09:00"),
  })
  .superRefine((value, ctx) => {
    if (value.audience === "TRAINEE" && !value.traineeUserId) {
      ctx.addIssue({ code: "custom", message: "Choose a trainee.", path: ["traineeUserId"] });
    }
  });

export type CreateCalendarActivityInput = z.infer<typeof createCalendarActivitySchema>;
