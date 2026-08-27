import type { Request, Response } from "express";
import { appUsageService } from "../services/app-usage.service";
import type { UsageHeartbeatInput } from "../validators/app-usage.validators";
import { sendSuccess } from "../utils/api-response";

export const appUsageController = {
  config(_req: Request, res: Response): void {
    sendSuccess(res, { config: appUsageService.getClientConfig() });
  },

  async heartbeat(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await appUsageService.heartbeat(req.user!, req.body as UsageHeartbeatInput));
  },

  async end(req: Request, res: Response): Promise<void> {
    await appUsageService.closeOpenSession(req.user!.id);
    sendSuccess(res, { ended: true });
  },

  async analytics(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await appUsageService.getAnalytics(req.user!, req.query));
  },
};
