import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { Prisma } from "../generated/prisma";
import { env } from "../config/env";
import type { ApiErrorResponse } from "../types/api";
import { ApiError } from "../utils/api-error";
import { logger } from "../utils/logger";

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return ApiError.badRequest(`This file is too large (max ${env.maxVideoUploadMb} MB)`);
    }
    return ApiError.badRequest("Unable to upload that file");
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return ApiError.conflict("A record with this value already exists");
    }

    if (error.code === "P2025") {
      return ApiError.notFound("Record not found");
    }

    if (error.code === "P2021") {
      return new ApiError(503, "Database schema is missing tables. Run migrations, then seed.", "DATABASE_SCHEMA");
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new ApiError(503, "Database unavailable", "DATABASE_UNAVAILABLE");
  }

  if (error instanceof SyntaxError) {
    return ApiError.badRequest("Invalid JSON payload");
  }

  return new ApiError(500, "Internal server error", "INTERNAL_ERROR");
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const apiError = toApiError(error);

  if (apiError.statusCode >= 500) {
    logger.error(apiError.message, env.isProduction ? undefined : error);
  }

  const body: ApiErrorResponse = {
    success: false,
    error: {
      message: apiError.message,
      code: apiError.code,
    },
  };

  res.status(apiError.statusCode).json(body);
}
