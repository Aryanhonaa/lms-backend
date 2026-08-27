import { InterventionStatus } from "../generated/prisma";
import type { Request, Response } from "express";
import { interventionService } from "../services/intervention.service";
import { programService } from "../services/program.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

function parseStatus(value: unknown): InterventionStatus | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (!Object.values(InterventionStatus).includes(value as InterventionStatus)) {
    return undefined;
  }
  return value as InterventionStatus;
}

export const interventionController = {
  async listFlags(req: Request, res: Response) {
    sendSuccess(res, await interventionService.listFlags(req.user!, parseStatus(req.query.status)));
  },

  async updateFlag(req: Request, res: Response) {
    sendSuccess(
      res,
      await interventionService.updateFlag(req.user!, routeParam(req, "id"), req.body.status),
    );
  },

  async listEnrollments(req: Request, res: Response) {
    sendSuccess(res, await interventionService.listTrainerEnrollments(req.user!));
  },

  async updateSettings(req: Request, res: Response) {
    sendSuccess(
      res,
      { program: await programService.updateInterventionSettings(req.user!, routeParam(req, "programId"), req.body) },
    );
  },

  async listRequirements(req: Request, res: Response) {
    sendSuccess(res, await interventionService.listRequirements(req.user!));
  },

  async getRequirement(req: Request, res: Response) {
    sendSuccess(res, await interventionService.getRequirement(req.user!, routeParam(req, "id")));
  },

  async assign(req: Request, res: Response) {
    sendSuccess(res, await interventionService.assign(req.user!, req.body), 201);
  },

  async startRequirement(req: Request, res: Response) {
    sendSuccess(res, await interventionService.startRequirement(req.user!, routeParam(req, "id")));
  },

  async completeRequirement(req: Request, res: Response) {
    sendSuccess(res, await interventionService.completeRequirement(req.user!, routeParam(req, "id")));
  },
};
