import type { NextFunction, Request, Response } from "express";
import { fileStorage } from "../storage";
import { assertSafeStorageKey } from "../storage/object-keys";

const AVATAR_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Streams avatars from object storage when they are not on the local uploads disk (e.g. R2). */
export async function servePublicUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.path.replace(/^\/+/, "");
  const relative = raw.startsWith("uploads/") ? raw.slice("uploads/".length) : raw;
  if (!relative.startsWith("avatars/")) {
    next();
    return;
  }

  let key: string;
  try {
    key = assertSafeStorageKey(relative);
  } catch {
    next();
    return;
  }

  const buffer = await fileStorage.get(key);
  if (!buffer) {
    next();
    return;
  }

  const dot = key.lastIndexOf(".");
  const ext = dot >= 0 ? key.slice(dot).toLowerCase() : "";
  res.setHeader("Content-Type", AVATAR_MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buffer);
}
