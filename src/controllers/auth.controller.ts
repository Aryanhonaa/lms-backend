import type { Request, Response } from "express";
import { env } from "../config/env";
import { authService } from "../services/auth.service";
import { ApiError } from "../utils/api-error";
import { clearSessionCookie, setSessionCookie } from "../utils/cookies";
import { sendSuccess } from "../utils/api-response";

function publicOrigin(req: Request): string {
  if (env.publicUrl) {
    return env.publicUrl;
  }
  const host = req.get("host");
  if (!host) {
    return `http://localhost:${env.port}`;
  }
  return `${req.protocol}://${host}`;
}

export const authController = {
  async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body as { email: string; password: string };
    const { user, token } = await authService.login(email, password);
    setSessionCookie(res, token);
    sendSuccess(res, { user });
  },

  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(authService.readSessionToken(req.cookies));
    clearSessionCookie(res);
    sendSuccess(res, { loggedOut: true });
  },

  me(req: Request, res: Response): void {
    sendSuccess(res, { user: req.user });
  },

  async updateAvatar(req: Request, res: Response): Promise<void> {
    if (!req.file) {
      throw ApiError.badRequest("Choose a profile picture to upload");
    }
    const user = await authService.updateAvatar(req.user!.id, req.file, publicOrigin(req));
    sendSuccess(res, { user });
  },

  async updateProfile(req: Request, res: Response): Promise<void> {
    const { name } = req.body as { name: string };
    const user = await authService.updateProfile(req.user!.id, name);
    sendSuccess(res, { user });
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    const user = await authService.changePassword(req.user!.id, currentPassword, newPassword);
    sendSuccess(res, { user });
  },
};
