import type { Request, Response } from "express";
import { fileStorage } from "../storage";
import { assertUploadFile } from "../storage/file-types";
import { sendSuccess } from "../utils/api-response";
import { publicOrigin } from "../utils/public-origin";
import { ApiError } from "../utils/api-error";

export const uploadController = {
  /**
   * Legacy trainer video upload. Kept for backward compatibility: content created
   * before R2 still resolves through the returned url when the provider is local.
   */
  async video(req: Request, res: Response): Promise<void> {
    const file = req.file;
    if (!file) {
      throw ApiError.badRequest("Choose a video file to upload");
    }
    const error = assertUploadFile({
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      purpose: "VIDEO",
    });
    if (error) {
      throw ApiError.badRequest(error);
    }

    const stored = await fileStorage.save(
      {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        folder: "videos",
      },
      publicOrigin(req),
    );

    sendSuccess(
      res,
      {
        url: stored.url ?? "",
        key: stored.key,
        fileName: stored.originalName,
        fileSize: stored.size,
        mimeType: stored.mimeType,
        storageProvider: stored.provider,
      },
      201,
    );
  },
};
