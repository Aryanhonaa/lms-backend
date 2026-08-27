import type { Request, Response } from "express";
import { learningService } from "../services/learning.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export const learningController = {
  async listEnrollments(req: Request, res: Response): Promise<void> {
    const enrollments = await learningService.listEnrollments(req.user!.id);
    sendSuccess(res, { enrollments });
  },

  async getProgram(req: Request, res: Response): Promise<void> {
    const view = await learningService.getLearnView(req.user!, routeParam(req, "programId"), queryString(req, "batchId"));
    sendSuccess(res, view);
  },

  async getLearn(req: Request, res: Response): Promise<void> {
    const view = await learningService.getLearnView(req.user!, routeParam(req, "programId"), queryString(req, "batchId"));
    sendSuccess(res, view);
  },

  async getItem(req: Request, res: Response): Promise<void> {
    const payload = await learningService.getItem(
      req.user!,
      routeParam(req, "itemType"),
      routeParam(req, "itemId"),
      queryString(req, "batchId"),
    );
    sendSuccess(res, payload);
  },

  async completeItem(req: Request, res: Response): Promise<void> {
    const view = await learningService.completeItem(
      req.user!,
      routeParam(req, "itemType"),
      routeParam(req, "itemId"),
      queryString(req, "batchId"),
    );
    sendSuccess(res, view);
  },
};
