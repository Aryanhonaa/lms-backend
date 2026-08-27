import type { Request } from "express";
import { env } from "../config/env";

export function publicOrigin(req: Request): string {
  if (env.publicUrl) {
    return env.publicUrl;
  }
  const host = req.get("host");
  if (!host) {
    return `http://localhost:${env.port}`;
  }
  return `${req.protocol}://${host}`;
}
