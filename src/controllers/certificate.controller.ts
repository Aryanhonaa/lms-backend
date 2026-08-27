import type { Request, Response } from "express";
import { certificateService } from "../services/certificate.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

export const certificateController = {
  async listMine(req: Request, res: Response) {
    sendSuccess(res, await certificateService.listForTrainee(req.user!));
  },

  async getMine(req: Request, res: Response) {
    sendSuccess(res, await certificateService.getForTrainee(req.user!, routeParam(req, "certificateId")));
  },

  async status(req: Request, res: Response) {
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;
    sendSuccess(res, await certificateService.statusForProgram(req.user!, routeParam(req, "programId"), batchId));
  },

  async listTrainer(req: Request, res: Response) {
    sendSuccess(res, await certificateService.listForTrainer(req.user!));
  },

  async listAdmin(req: Request, res: Response) {
    sendSuccess(res, await certificateService.listForAdmin(req.user!));
  },

  async revoke(req: Request, res: Response) {
    sendSuccess(res, await certificateService.revoke(req.user!, routeParam(req, "certificateId"), req.body.reason));
  },

  async verify(req: Request, res: Response) {
    const fromParam = req.params.certificateId;
    const fromQuery = typeof req.query.certificateId === "string" ? req.query.certificateId : undefined;
    const fromBody = typeof req.body?.certificateId === "string" ? req.body.certificateId : undefined;
    const certificateId = (typeof fromParam === "string" && fromParam) || fromQuery || fromBody || "";
    sendSuccess(res, await certificateService.verifyPublic(certificateId));
  },
};
