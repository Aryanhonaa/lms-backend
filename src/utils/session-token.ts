import { createHash, randomBytes } from "crypto";
import { env } from "../config/env";

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(`${token}.${env.jwtSecret}`).digest("hex");
}
