import type { CookieOptions, Response } from "express";
import { env, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../config/env";

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
  });
}
