import type { Request, Response } from "express";
import { env } from "../config/env";
import { batchService } from "../services/batch.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";
import { civilNoonInZone } from "../utils/timezone";

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function queryInt(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const batchController = {
  async list(req: Request, res: Response) {
    sendSuccess(res, await batchService.listForProgram(req.user!, routeParam(req, "programId")));
  },

  async previewCode(req: Request, res: Response) {
    const month = queryInt(req.query.month);
    const year = queryInt(req.query.year);
    const batchNumber = queryInt(req.query.batchNumber);
    sendSuccess(
      res,
      await batchService.previewCode({
        startDate: queryString(req.query.startDate),
        month: month && month >= 1 && month <= 12 ? month : undefined,
        year: year && year >= 2000 && year <= 2100 ? year : undefined,
        batchNumber: batchNumber && batchNumber >= 1 && batchNumber <= 999 ? batchNumber : undefined,
      }),
    );
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
    const joinedAt = req.body.joinedAt ? civilNoonInZone(req.body.joinedAt, env.timezone) ?? undefined : undefined;
    sendSuccess(
      res,
      await batchService.enroll(req.user!, routeParam(req, "batchId"), req.body.traineeIds, joinedAt),
    );
  },
};
