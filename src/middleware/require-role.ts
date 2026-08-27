import type { Role } from "../generated/prisma";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../utils/api-error";

export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden());
      return;
    }

    next();
  };
}
