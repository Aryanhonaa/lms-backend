import { Router } from "express";
import { programController } from "../controllers/program.controller";
import { requireAuth } from "../middleware/require-auth";
import { requireRole } from "../middleware/require-role";
import { validateBody } from "../middleware/validate-body";
import { asyncHandler } from "../utils/async-handler";
import { rejectProgramSchema } from "../validators/program.validators";

export const programWorkflowRouter = Router();

programWorkflowRouter.post(
  "/:id/submit",
  requireAuth,
  requireRole("TRAINER"),
  asyncHandler(programController.submit),
);
programWorkflowRouter.post(
  "/:id/approve",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(programController.approve),
);
programWorkflowRouter.post(
  "/:id/reject",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  validateBody(rejectProgramSchema),
  asyncHandler(programController.reject),
);
