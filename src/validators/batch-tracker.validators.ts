import { z } from "zod";

const lineOfBusiness = z.enum(["VOICE", "NON_VOICE"]);

export const exitEnrollmentSchema = z.object({
  type: z.enum(["LEFT", "TERMINATED"]),
  date: z.iso.date().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const removeEnrollmentSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const joinedDateSchema = z.object({
  date: z.iso.date(),
});

export const handoverSchema = z.object({
  enrollmentIds: z.array(z.string().uuid()).min(1).max(100),
  teamId: z.string().uuid(),
  date: z.iso.date().optional(),
});

export const teamSchema = z.object({
  name: z.string().trim().min(1).max(80),
  lineOfBusiness: lineOfBusiness.optional().nullable(),
  supervisorName: z.string().trim().max(120).optional(),
});

export const updateTeamSchema = teamSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const holidaysSchema = z.object({
  holidays: z
    .array(
      z.object({
        date: z.iso.date(),
        name: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(100),
});

export const weeklyOffDaysSchema = z.object({
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(6),
});
