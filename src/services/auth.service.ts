import { env, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../config/env";
import { sessionRepository } from "../repositories/session.repository";
import { userRepository } from "../repositories/user.repository";
import { fileStorage } from "../storage";
import { appUsageService } from "./app-usage.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { createSessionToken, hashSessionToken } from "../utils/session-token";
import { verifyPassword } from "../utils/password";

const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_NAME = /\.(jpe?g|png|webp)$/i;

function toAuthUser(user: {
  id: string;
  name: string;
  email: string;
  role: AuthUser["role"];
  avatarUrl?: string | null;
  createdAt: Date;
}): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
  };
}

function storageKeyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const marker = "/uploads/";
  const index = url.indexOf(marker);
  if (index === -1) {
    return null;
  }
  const key = url.slice(index + marker.length).replace(/^\/+/, "");
  return key.length > 0 ? key : null;
}

export const authService = {
  async login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await userRepository.findByEmail(normalizedEmail);
    const passwordValid = await verifyPassword(password, user?.passwordHash ?? null);

    if (!user || !user.isActive || !passwordValid) {
      throw ApiError.invalidCredentials();
    }

    const token = createSessionToken();
    await sessionRepository.create({
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    return { user: toAuthUser(user), token };
  },

  async logout(token: string | undefined): Promise<void> {
    if (!token) {
      return;
    }

    const session = await sessionRepository.findByTokenHash(hashSessionToken(token));
    if (session?.userId) {
      await appUsageService.closeOpenSession(session.userId);
    }
    await sessionRepository.deleteByTokenHash(hashSessionToken(token));
  },

  async getUserForToken(token: string | undefined): Promise<AuthUser> {
    if (!token) {
      throw ApiError.unauthorized();
    }

    const session = await sessionRepository.findByTokenHash(hashSessionToken(token));

    if (!session) {
      throw ApiError.unauthorized();
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await sessionRepository.deleteById(session.id);
      throw ApiError.sessionExpired();
    }

    if (!session.user.isActive) {
      await sessionRepository.deleteById(session.id);
      throw ApiError.unauthorized();
    }

    return toAuthUser(session.user);
  },

  readSessionToken(cookies: Record<string, unknown> | undefined): string | undefined {
    const value = cookies?.[SESSION_COOKIE_NAME];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  },

  async updateAvatar(
    userId: string,
    file: Express.Multer.File,
    publicOrigin: string,
  ): Promise<AuthUser> {
    const mimeOk = AVATAR_TYPES.has(file.mimetype);
    const unnamedBinary = !file.mimetype || file.mimetype === "application/octet-stream";
    if (!mimeOk && !(unnamedBinary && AVATAR_NAME.test(file.originalname))) {
      throw ApiError.badRequest("Upload a JPG, PNG, or WEBP image");
    }
    if (file.size > env.maxAvatarUploadMb * 1024 * 1024) {
      throw ApiError.badRequest(`Profile picture must be ${env.maxAvatarUploadMb} MB or smaller`);
    }

    const current = await userRepository.findPublicById(userId);
    const stored = await fileStorage.save(
      {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        folder: "avatars",
      },
      publicOrigin,
    );

    // Same-origin path so the Next.js /uploads rewrite can serve the file.
    // R2 save() returns url: null; never persist that or the photo disappears.
    const avatarUrl = `/uploads/${stored.key}`;
    const updated = await userRepository.updateAvatar(userId, avatarUrl);
    const previousKey = storageKeyFromPublicUrl(current?.avatarUrl);
    if (previousKey && previousKey !== stored.key) {
      await fileStorage.delete(previousKey);
    }

    return toAuthUser(updated);
  },
};
