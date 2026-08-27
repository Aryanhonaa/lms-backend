import type { Request, Response } from "express";
import { assignmentService } from "../services/assignment.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";
import { ApiError } from "../utils/api-error";

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export const assignmentController = {
  async listForTrainee(req: Request, res: Response) {
    sendSuccess(res, await assignmentService.listForTrainee(req.user!));
  },

  async getForTrainee(req: Request, res: Response) {
    sendSuccess(res, await assignmentService.getForTrainee(req.user!, routeParam(req, "id"), queryString(req, "batchId")));
  },

  async submit(req: Request, res: Response) {
    sendSuccess(
      res,
      await assignmentService.submit(req.user!, routeParam(req, "id"), {
        ...req.body,
        batchId: typeof req.body?.batchId === "string" ? req.body.batchId : queryString(req, "batchId"),
      }),
    );
  },

  async addFile(req: Request, res: Response) {
    if (!req.file) {
      throw ApiError.badRequest("Choose a file to upload.");
    }
    sendSuccess(res, await assignmentService.addFile(req.user!, routeParam(req, "id"), req.file), 201);
  },

  async removeFile(req: Request, res: Response) {
    sendSuccess(
      res,
      await assignmentService.removeFile(req.user!, routeParam(req, "id"), routeParam(req, "fileId")),
    );
  },

  async downloadFile(req: Request, res: Response) {
    const file = await assignmentService.downloadFile(req.user!, routeParam(req, "id"), routeParam(req, "fileId"));
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.send(file.buffer);
  },

  async fileAccess(req: Request, res: Response) {
    sendSuccess(
      res,
      await assignmentService.fileAccess(req.user!, routeParam(req, "id"), routeParam(req, "fileId")),
    );
  },

  async listForTrainer(req: Request, res: Response) {
    sendSuccess(
      res,
      await assignmentService.listForTrainer(req.user!, queryString(req, "programId"), queryString(req, "batchId")),
    );
  },

  async getForTrainer(req: Request, res: Response) {
    sendSuccess(
      res,
      await assignmentService.getForTrainer(
        req.user!,
        routeParam(req, "id"),
        queryString(req, "programId"),
        queryString(req, "batchId"),
      ),
    );
  },

  async review(req: Request, res: Response) {
    sendSuccess(res, await assignmentService.review(req.user!, routeParam(req, "id"), req.body));
  },
};
