import { z } from "zod";

export const revokeCertificateSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
