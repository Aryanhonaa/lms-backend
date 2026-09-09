import type { Request, Response } from "express";
import { trainingTrackerService } from "../services/training-tracker.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const trainingTrackerController = {
  async options(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.options(req.user!));
  },

  async dashboard(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.dashboard(req.user!));
  },

  async listBatches(req: Request, res: Response) {
    sendSuccess(
      res,
      await trainingTrackerService.listBatches(req.user!, {
        month: optionalNumber(req.query.month),
        year: optionalNumber(req.query.year),
        process: optionalString(req.query.process),
        trainerId: optionalString(req.query.trainerId),
        status: optionalString(req.query.status),
        programId: optionalString(req.query.programId),
        dateFrom: optionalString(req.query.dateFrom),
        dateTo: optionalString(req.query.dateTo),
      }),
    );
  },

  async getBatch(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.getBatch(req.user!, routeParam(req, "batchId")));
  },

  async createBatch(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.createBatch(req.user!, req.body), 201);
  },

  async updateBatch(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.updateBatch(req.user!, routeParam(req, "batchId"), req.body));
  },

  async addTrainee(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.addTrainee(req.user!, routeParam(req, "batchId"), req.body), 201);
  },

  async addStandalone(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.addStandaloneTrainee(req.user!, req.body), 201);
  },

  async listTrainees(req: Request, res: Response) {
    sendSuccess(
      res,
      await trainingTrackerService.listTrainees(req.user!, {
        batchId: optionalString(req.query.batchId),
        trainerId: optionalString(req.query.trainerId),
        process: optionalString(req.query.process),
        team: optionalString(req.query.team),
        status: optionalString(req.query.status),
      }),
    );
  },

  async recordAttrition(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.recordAttrition(req.user!, routeParam(req, "traineeId"), req.body));
  },

  async recordExam(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.recordExam(req.user!, routeParam(req, "traineeId"), req.body));
  },

  async recordHandover(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.recordHandover(req.user!, routeParam(req, "traineeId"), req.body));
  },

  async listAudits(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.listAudits(req.user!));
  },

  async createAudit(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.createAudit(req.user!, req.body), 201);
  },

  async listTni(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.listTni(req.user!));
  },

  async updateTniSupport(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.updateTniSupport(req.user!, routeParam(req, "tniId"), req.body));
  },

  async decideTni(req: Request, res: Response) {
    sendSuccess(res, await trainingTrackerService.decideTni(req.user!, routeParam(req, "tniId"), req.body));
  },
};
