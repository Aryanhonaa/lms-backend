import type { Response } from "express";
import type { ApiSuccessResponse } from "../types/api";

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
  };

  return res.status(statusCode).json(body);
}
