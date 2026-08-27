import type { ProgramStatus } from "../generated/prisma";
import type { Request, Response } from "express";
import { programService } from "../services/program.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

export const programController = {
  async create(req: Request, res: Response): Promise<void> {
    const program = await programService.create(req.user!, req.body);
    sendSuccess(res, { program }, 201);
  },

  async listMine(req: Request, res: Response): Promise<void> {
    const programs = await programService.listForTrainer(req.user!.id);
    sendSuccess(res, { programs });
  },

  async listForAdmin(req: Request, res: Response): Promise<void> {
    if (req.query.view === "all") {
      const programs = await programService.listCatalog();
      sendSuccess(res, { programs });
      return;
    }

    const status = typeof req.query.status === "string" ? (req.query.status as ProgramStatus) : undefined;
    const programs = await programService.listForAdmin(status);
    sendSuccess(res, { programs });
  },

  async get(req: Request, res: Response): Promise<void> {
    const program = await programService.getTreeForUser(req.user!, routeParam(req, "programId"));
    sendSuccess(res, { program });
  },

  async update(req: Request, res: Response): Promise<void> {
    const program = await programService.update(req.user!, routeParam(req, "programId"), req.body);
    sendSuccess(res, { program });
  },

  async submit(req: Request, res: Response): Promise<void> {
    const program = await programService.submit(req.user!, routeParam(req, "id"));
    sendSuccess(res, { program });
  },

  async approve(req: Request, res: Response): Promise<void> {
    const program = await programService.approve(req.user!, routeParam(req, "id"));
    sendSuccess(res, { program });
  },

  async reject(req: Request, res: Response): Promise<void> {
    const program = await programService.reject(req.user!, routeParam(req, "id"), req.body.reason);
    sendSuccess(res, { program });
  },

  async remove(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await programService.remove(req.user!, routeParam(req, "programId")));
  },
};
