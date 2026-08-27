import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer, { MulterError } from "multer";
import { authController } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/require-auth";
import { validateBody } from "../middleware/validate-body";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { loginSchema } from "../validators/auth.validators";

export const authRouter = Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function acceptAvatar(req: Request, res: Response, next: NextFunction): void {
  avatarUpload.single("file")(req, res, (err: unknown) => {
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      next(ApiError.badRequest("Profile picture must be 5 MB or smaller"));
      return;
    }
    next(err);
  });
}

authRouter.post(
  "/login",
  // loginRateLimiter,
  validateBody(loginSchema),
  asyncHandler(authController.login),
);
authRouter.post("/logout", asyncHandler(authController.logout));
authRouter.get("/me", requireAuth, authController.me);
authRouter.post("/avatar", requireAuth, acceptAvatar, asyncHandler(authController.updateAvatar));
