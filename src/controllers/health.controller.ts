import type { Request, Response } from "express";
import { healthService } from "../services/health.service";
import { sendSuccess } from "../utils/api-response";

export const healthController = {
  get(_req: Request, res: Response): void {
    sendSuccess(res, healthService.getStatus());
  },
};
