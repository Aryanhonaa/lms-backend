import type { Request, Response } from "express";
import { attendanceService } from "../services/attendance.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

export const attendanceController = {
  async listProgram(req: Request, res: Response) {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    sendSuccess(res, await attendanceService.listProgram(req.user!, routeParam(req, "programId"), sessionId));
  },

  async mark(req: Request, res: Response) {
    sendSuccess(res, await attendanceService.mark(req.user!, routeParam(req, "sessionId"), req.body.records));
  },

  async update(req: Request, res: Response) {
    sendSuccess(res, await attendanceService.update(req.user!, routeParam(req, "id"), req.body.status));
  },

  async listMine(req: Request, res: Response) {
    sendSuccess(res, await attendanceService.listForTrainee(req.user!));
  },

  async getRecord(req: Request, res: Response) {
    sendSuccess(res, await attendanceService.getRecord(req.user!, routeParam(req, "id")));
  },
};
