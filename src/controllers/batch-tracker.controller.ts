import type { Request, Response } from "express";
import { batchTrackerService, parseTrackerFilters } from "../services/batch-tracker.service";
import { enrollmentLifecycleService } from "../services/enrollment-lifecycle.service";
import { teamService } from "../services/team.service";
import { workCalendarService } from "../services/work-calendar.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

export const batchTrackerController = {
  async overview(req: Request, res: Response) {
    sendSuccess(res, await batchTrackerService.overview(req.user!, parseTrackerFilters(req.query)));
  },

  async detail(req: Request, res: Response) {
    sendSuccess(res, await batchTrackerService.detail(req.user!, routeParam(req, "batchId")));
  },

  async exit(req: Request, res: Response) {
    sendSuccess(res, await enrollmentLifecycleService.exit(req.user!, routeParam(req, "enrollmentId"), req.body));
  },

  async remove(req: Request, res: Response) {
    sendSuccess(res, await enrollmentLifecycleService.remove(req.user!, routeParam(req, "enrollmentId"), req.body ?? {}));
  },

  async reinstate(req: Request, res: Response) {
    sendSuccess(res, await enrollmentLifecycleService.reinstate(req.user!, routeParam(req, "enrollmentId")));
  },

  async setJoinedDate(req: Request, res: Response) {
    sendSuccess(
      res,
      await enrollmentLifecycleService.setJoinedDate(req.user!, routeParam(req, "enrollmentId"), req.body.date),
    );
  },

  async handover(req: Request, res: Response) {
    sendSuccess(res, await enrollmentLifecycleService.handover(req.user!, routeParam(req, "batchId"), req.body));
  },

  async undoHandover(req: Request, res: Response) {
    sendSuccess(res, await enrollmentLifecycleService.undoHandover(req.user!, routeParam(req, "enrollmentId")));
  },
};

export const teamController = {
  async list(_req: Request, res: Response) {
    sendSuccess(res, await teamService.list());
  },

  async create(req: Request, res: Response) {
    sendSuccess(res, await teamService.create(req.body), 201);
  },

  async update(req: Request, res: Response) {
    sendSuccess(res, await teamService.update(routeParam(req, "teamId"), req.body));
  },
};

export const workCalendarController = {
  async get(_req: Request, res: Response) {
    sendSuccess(res, await workCalendarService.get());
  },

  async setWeeklyOffDays(req: Request, res: Response) {
    sendSuccess(res, await workCalendarService.setWeeklyOffDays(req.body.weeklyOffDays));
  },

  async addHolidays(req: Request, res: Response) {
    sendSuccess(res, await workCalendarService.addHolidays(req.body.holidays), 201);
  },

  async removeHoliday(req: Request, res: Response) {
    sendSuccess(res, await workCalendarService.removeHoliday(routeParam(req, "holidayId")));
  },
};
