import type { Request, Response } from "express";
import { assessmentService } from "../services/assessment.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export const assessmentController = {
  async listForTrainee(req: Request, res: Response) {
    sendSuccess(res, await assessmentService.listForTrainee(req.user!));
  },

  async getForTrainee(req: Request, res: Response) {
    sendSuccess(res, await assessmentService.getForTrainee(req.user!, routeParam(req, "id")));
  },

  async startAttempt(req: Request, res: Response) {
    const result = await assessmentService.startAttempt(req.user!, routeParam(req, "id"));
    sendSuccess(res, { attempt: result.attempt }, result.created ? 201 : 200);
  },

  async getAttempt(req: Request, res: Response) {
    sendSuccess(res, await assessmentService.getAttempt(req.user!, routeParam(req, "id")));
  },

  async submitAttempt(req: Request, res: Response) {
    sendSuccess(res, await assessmentService.submitAttempt(req.user!, routeParam(req, "id"), req.body.answers));
  },

  async listForTrainer(req: Request, res: Response) {
    sendSuccess(
      res,
      await assessmentService.listForTrainer(req.user!, queryString(req, "programId"), queryString(req, "batchId")),
    );
  },

  async getForTrainer(req: Request, res: Response) {
    sendSuccess(
      res,
      await assessmentService.getForTrainer(
        req.user!,
        routeParam(req, "id"),
        queryString(req, "programId"),
        queryString(req, "batchId"),
      ),
    );
  },
};
