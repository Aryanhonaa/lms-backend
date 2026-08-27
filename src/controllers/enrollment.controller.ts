import type { Request, Response } from "express";
import { enrollmentService } from "../services/enrollment.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

function parseIntQuery(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export const enrollmentController = {
  async listEligible(req: Request, res: Response) {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const skip = parseIntQuery(req.query.skip, 0, 0, 10_000);
    const take = parseIntQuery(req.query.take, 20, 1, 50);
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;
    sendSuccess(
      res,
      await enrollmentService.listEligibleTrainees(
        req.user!,
        routeParam(req, "programId"),
        query,
        skip,
        take,
        batchId,
      ),
    );
  },

  async listProgramTrainees(req: Request, res: Response) {
    sendSuccess(res, await enrollmentService.listProgramTrainees(req.user!, routeParam(req, "programId")));
  },

  async enroll(req: Request, res: Response) {
    sendSuccess(
      res,
      await enrollmentService.enrollTrainees(
        req.user!,
        routeParam(req, "programId"),
        req.body.traineeIds,
        req.body.batchId,
      ),
    );
  },
};
