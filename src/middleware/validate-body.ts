import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../utils/api-error";

type Schema<T> = {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false };
};

export function validateBody<T>(schema: Schema<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(ApiError.badRequest("Invalid request"));
      return;
    }

    req.body = result.data;
    next();
  };
}
