import type { Request, Response } from "express";
import { progressService } from "../services/progress.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

export const progressController = {
  async list(req: Request, res: Response): Promise<void> {
    const programId = typeof req.query.programId === "string" ? req.query.programId : null;
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;
    if (programId) {
      const progress = await progressService.getProgressView(req.user!, programId, batchId);
      sendSuccess(res, progress);
      return;
    }
    const enrollments = await progressService.listProgress(req.user!.id);
    sendSuccess(res, { enrollments });
  },

  async getProgram(req: Request, res: Response): Promise<void> {
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;
    const progress = await progressService.getProgressView(req.user!, routeParam(req, "programId"), batchId);
    sendSuccess(res, progress);
  },
};
