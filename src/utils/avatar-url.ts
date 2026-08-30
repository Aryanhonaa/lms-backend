import { env } from "../config/env";
import { fileStorage } from "../storage";
import type { Role } from "../generated/prisma";

export function avatarStorageKey(avatarRef: string | null | undefined): string | null {
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

export async function resolveAvatarUrl(avatarRef: string | null | undefined): Promise<string | null> {
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

export type PublicUserRecord = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function serializePublicUser<T extends PublicUserRecord>(user: T) {
  return {
    ...user,
    avatarUrl: await resolveAvatarUrl(user.avatarUrl),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function serializePublicUsers<T extends PublicUserRecord>(users: T[]) {
  return Promise.all(users.map((user) => serializePublicUser(user)));
}
