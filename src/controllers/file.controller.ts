import type { Request, Response } from "express";
import { fileService, type CurriculumItemType } from "../services/file.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";
import { ApiError } from "../utils/api-error";

const ITEM_TYPES = new Set<CurriculumItemType>(["VIDEO", "RESOURCE", "REEL"]);

function itemType(req: Request): CurriculumItemType {
  const value = routeParam(req, "itemType").trim().toUpperCase() as CurriculumItemType;
  if (!ITEM_TYPES.has(value)) {
    throw ApiError.badRequest("Invalid content type");
  }
  return value;
}

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function sendFile(res: Response, file: { buffer: Buffer; fileName: string; mimeType: string }, download: boolean) {
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename="${file.fileName.replace(/"/g, "")}"`,
  );
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.send(file.buffer);
}

export const fileController = {
  async uploadTrainerFile(req: Request, res: Response) {
    if (!req.file) {
      throw ApiError.badRequest("Choose a file to upload.");
    }
    sendSuccess(
      res,
      await fileService.uploadTrainerFile(req.user!, req.file, {
        purpose: req.body?.purpose,
        dayId: typeof req.body?.dayId === "string" ? req.body.dayId : undefined,
        contentId: typeof req.body?.contentId === "string" ? req.body.contentId : undefined,
      }),
      201,
    );
  },

  async createUploadTicket(req: Request, res: Response) {
    sendSuccess(res, await fileService.createUploadTicket(req.user!, req.body), 201);
  },

  async confirmUpload(req: Request, res: Response) {
    sendSuccess(res, await fileService.confirmUpload(req.user!, req.body), 201);
  },

  async trainerItemAccess(req: Request, res: Response) {
    sendSuccess(res, await fileService.trainerItemAccess(req.user!, itemType(req), routeParam(req, "itemId")));
  },

  async adminItemAccess(req: Request, res: Response) {
    sendSuccess(res, await fileService.adminItemAccess(req.user!, itemType(req), routeParam(req, "itemId")));
  },

  async traineeItemAccess(req: Request, res: Response) {
    sendSuccess(
      res,
      await fileService.traineeItemAccess(req.user!, itemType(req), routeParam(req, "itemId"), queryString(req, "batchId")),
    );
  },

  async streamItem(req: Request, res: Response) {
    const file = await fileService.streamCurriculumFile(
      req.user!,
      itemType(req),
      routeParam(req, "itemId"),
      queryString(req, "batchId"),
    );
    sendFile(res, file, queryString(req, "download") === "1");
  },

  async listLessonAttachments(req: Request, res: Response) {
    sendSuccess(res, await fileService.listLessonAttachments(req.user!, routeParam(req, "lessonId")));
  },

  async addLessonAttachment(req: Request, res: Response) {
    if (!req.file) {
      throw ApiError.badRequest("Choose a file to upload.");
    }
    sendSuccess(
      res,
      await fileService.addLessonAttachment(
        req.user!,
        routeParam(req, "lessonId"),
        req.file,
        typeof req.body?.title === "string" ? req.body.title : undefined,
      ),
      201,
    );
  },

  async addAssignmentAttachment(req: Request, res: Response) {
    if (!req.file) {
      throw ApiError.badRequest("Choose a file to upload.");
    }
    sendSuccess(
      res,
      await fileService.addAssignmentAttachment(
        req.user!,
        routeParam(req, "assignmentId"),
        req.file,
        typeof req.body?.title === "string" ? req.body.title : undefined,
      ),
      201,
    );
  },

  async removeAttachment(req: Request, res: Response) {
    sendSuccess(res, await fileService.removeAttachment(req.user!, routeParam(req, "attachmentId")));
  },

  async attachmentAccess(req: Request, res: Response) {
    sendSuccess(
      res,
      await fileService.attachmentAccess(req.user!, routeParam(req, "attachmentId"), queryString(req, "batchId")),
    );
  },

  async streamAttachment(req: Request, res: Response) {
    const file = await fileService.streamAttachment(
      req.user!,
      routeParam(req, "attachmentId"),
      queryString(req, "batchId"),
    );
    sendFile(res, file, queryString(req, "download") === "1");
  },
};
