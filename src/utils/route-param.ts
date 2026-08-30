import type { Request } from "express";
import { ApiError } from "./api-error";

export function routeParam(req: Request, name: string): string {
  const value = req.params[name];

  if (typeof value !== "string" || value.length === 0) {
    throw ApiError.badRequest("Invalid request");
  }

  return decodeURIComponent(value.trim());
}
