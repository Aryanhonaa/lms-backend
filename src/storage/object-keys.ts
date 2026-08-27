import { randomUUID } from "node:crypto";
import path from "node:path";

const MIME_EXTENSION: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
};

export function extensionFor(originalName: string, mimeType: string): string {
  const fromName = path.extname(originalName).toLowerCase();
  if (fromName && fromName.length <= 12) {
    return fromName.replace(/[^.a-z0-9]/g, "");
  }
  return MIME_EXTENSION[mimeType] ?? "";
}

export function buildObjectKey(folder: string, originalName: string, mimeType: string): string {
  const cleanFolder = folder.replace(/[^a-z0-9/_-]/gi, "").replace(/\.\./g, "").replace(/^\/+|\/+$/g, "");
  if (!cleanFolder) {
    throw new Error("Invalid storage folder");
  }
  const ext = extensionFor(originalName, mimeType);
  return `${cleanFolder}/${randomUUID()}${ext}`;
}

export function assertSafeStorageKey(key: string): string {
  const safe = key.replace(/\.\./g, "").replace(/^[/\\]+/, "");
  if (!safe || safe.includes("\\") || safe.includes("://")) {
    throw new Error("Invalid storage key");
  }
  return safe;
}
