import { env, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../config/env";
import { sessionRepository } from "../repositories/session.repository";
import { userRepository } from "../repositories/user.repository";
import { fileStorage } from "../storage";
import { appUsageService } from "./app-usage.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { createSessionToken, hashSessionToken } from "../utils/session-token";
import { hashPassword, verifyPassword } from "../utils/password";

const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function avatarStorageKey(avatarRef: string | null | undefined): string | null {
  if (!avatarRef) {
    return null;
  }

  const marker = "/uploads/";
  const index = avatarRef.indexOf(marker);
  if (index !== -1) {
    const key = avatarRef.slice(index + marker.length).replace(/^\/+/, "");
    return key.length > 0 ? key : null;
  }

  if (!avatarRef.startsWith("http://") && !avatarRef.startsWith("https://")) {
    const key = avatarRef.replace(/^\/+/, "");
    return key.length > 0 ? key : null;
  }

  return null;
}

async function resolveAvatarUrl(avatarRef: string | null | undefined): Promise<string | null> {
  if (!avatarRef) {
    return null;
  }

  if (avatarRef.startsWith("http://") || avatarRef.startsWith("https://")) {
    return avatarRef;
  }

  const key = avatarStorageKey(avatarRef);
  if (!key) {
    return null;
  }

  return fileStorage.signedDownloadUrl(key, {
    expiresInSeconds: env.signedUrlExpiresSeconds,
  });
}

async function serializeAuthUser(user: {
  id: string;
  name: string;
  email: string;
  role: AuthUser["role"];
  avatarUrl?: string | null;
  createdAt: Date;
}): Promise<AuthUser> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: await resolveAvatarUrl(user.avatarUrl ?? null),
    createdAt: user.createdAt,
  };
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

    return { user: await serializeAuthUser(user), token };
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

    return serializeAuthUser(session.user);
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
    if (!AVATAR_TYPES.has(file.mimetype)) {
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

    const avatarRef = stored.url ?? stored.key;
    const updated = await userRepository.updateAvatar(userId, avatarRef);
    const previousKey = avatarStorageKey(current?.avatarUrl);
    if (previousKey && previousKey !== stored.key) {
      await fileStorage.delete(previousKey);
    }

    return serializeAuthUser(updated);
  },

  async updateProfile(userId: string, name: string): Promise<AuthUser> {
    const updated = await userRepository.updateName(userId, name.trim());
    return serializeAuthUser(updated);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthUser> {
    const user = await userRepository.findById(userId);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized();
    }

    const currentValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentValid) {
      throw ApiError.badRequest("Current password is incorrect");
    }

    const passwordHash = await hashPassword(newPassword);
    const updated = await userRepository.updatePasswordHash(userId, passwordHash);
    return serializeAuthUser(updated);
  },
};
