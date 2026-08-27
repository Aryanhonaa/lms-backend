import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service";

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.user = await authService.getUserForToken(authService.readSessionToken(req.cookies));
    next();
  } catch (error) {
    next(error);
  }
}
