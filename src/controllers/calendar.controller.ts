import type { Request, Response } from "express";
import { calendarActivityService } from "../services/calendar-activity.service";
import { calendarService } from "../services/calendar.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

export const calendarController = {
  async list(req: Request, res: Response) {
    sendSuccess(res, await calendarService.listForUser(req.user!));
  },

  async createActivity(req: Request, res: Response) {
    sendSuccess(res, await calendarActivityService.create(req.user!, req.body), 201);
  },

  async removeActivity(req: Request, res: Response) {
    sendSuccess(res, await calendarActivityService.remove(req.user!, routeParam(req, "activityId")));
  },
};
