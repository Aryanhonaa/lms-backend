import type { Request, Response } from "express";
import { batchService } from "../services/batch.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

export const batchController = {
  async list(req: Request, res: Response) {
    sendSuccess(res, await batchService.listForProgram(req.user!, routeParam(req, "programId")));
  },

  async create(req: Request, res: Response) {
    sendSuccess(res, await batchService.create(req.user!, routeParam(req, "programId"), req.body), 201);
  },

  async update(req: Request, res: Response) {
    sendSuccess(res, await batchService.update(req.user!, routeParam(req, "batchId"), req.body));
  },

  async remove(req: Request, res: Response) {
    sendSuccess(res, await batchService.remove(req.user!, routeParam(req, "batchId")));
  },

  async listTrainees(req: Request, res: Response) {
    sendSuccess(res, await batchService.listTrainees(req.user!, routeParam(req, "batchId")));
  },

  async enroll(req: Request, res: Response) {
    sendSuccess(res, await batchService.enroll(req.user!, routeParam(req, "batchId"), req.body.traineeIds));
  },
};
