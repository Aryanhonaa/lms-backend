import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "TRAINER", "TRAINEE"]),
  password: z.string().min(8).max(128),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
