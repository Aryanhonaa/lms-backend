import type { Request, Response } from "express";
import { calendarService } from "../services/calendar.service";
import { sendSuccess } from "../utils/api-response";

export const calendarController = {
  async list(req: Request, res: Response) {
    sendSuccess(res, await calendarService.listForUser(req.user!));
  },
};
