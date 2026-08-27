import { env } from "../config/env";
import { fileExtension } from "../utils/submission-files";

export type UploadPurpose =
  | "VIDEO"
  | "REEL"
  | "RESOURCE"
  | "LESSON_ATTACHMENT"
  | "ASSIGNMENT_ATTACHMENT"
  | "SUBMISSION"
  | "AVATAR";

const BLOCKED_EXT = new Set(["exe", "bat", "cmd", "com", "msi", "js", "mjs", "cjs", "sh", "ps1", "dll", "apk"]);

const MIME_BY_EXT: Record<string, string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  zip: ["application/zip", "application/x-zip-compressed"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain"],
  csv: ["text/csv", "application/vnd.ms-excel"],
  mp4: ["video/mp4"],
  webm: ["video/webm"],
  mov: ["video/quicktime"],
  mp3: ["audio/mpeg", "audio/mp3"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
  m4a: ["audio/mp4", "audio/x-m4a"],
  ogg: ["audio/ogg"],
};

const PURPOSE_EXTENSIONS: Record<UploadPurpose, string[]> = {
  VIDEO: ["mp4", "webm", "mov"],
  REEL: ["mp4", "webm", "mov"],
  RESOURCE: ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "png", "jpg", "jpeg", "webp", "gif", "txt", "md", "csv", "zip"],
  LESSON_ATTACHMENT: ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "png", "jpg", "jpeg", "webp", "gif", "txt", "md", "csv"],
  ASSIGNMENT_ATTACHMENT: ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "png", "jpg", "jpeg", "webp", "gif", "txt", "md", "csv", "zip"],
  SUBMISSION: ["pdf", "doc", "docx", "png", "jpg", "jpeg", "zip", "txt"],
  AVATAR: ["jpg", "jpeg", "png", "webp"],
};

export function maxBytesForPurpose(purpose: UploadPurpose, overrideMb?: number): number {
  if (overrideMb && overrideMb > 0) {
    return overrideMb * 1024 * 1024;
  }
  if (purpose === "VIDEO" || purpose === "REEL") {
    return env.maxVideoUploadMb * 1024 * 1024;
  }
  if (purpose === "AVATAR") {
    return env.maxAvatarUploadMb * 1024 * 1024;
  }
  if (purpose === "RESOURCE" || purpose === "LESSON_ATTACHMENT" || purpose === "ASSIGNMENT_ATTACHMENT") {
    return env.maxDocumentUploadMb * 1024 * 1024;
  }
  return env.maxDocumentUploadMb * 1024 * 1024;
}

export function allowedExtensionsForPurpose(purpose: UploadPurpose, override?: string): string[] {
  if (override && override.trim()) {
    return override
      .split(",")
      .map((part) => part.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean);
  }
  return PURPOSE_EXTENSIONS[purpose];
}

export function assertUploadFile(input: {
  fileName: string;
  mimeType: string;
  size: number;
  purpose: UploadPurpose;
  allowedTypes?: string;
  maxBytes?: number;
}): string | null {
  const maxBytes = input.maxBytes ?? maxBytesForPurpose(input.purpose);
  if (input.size > maxBytes) {
    return `File is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  }
  const ext = fileExtension(input.fileName);
  if (!ext || BLOCKED_EXT.has(ext)) {
    return "This file type isn't supported.";
  }
  const allowed = allowedExtensionsForPurpose(input.purpose, input.allowedTypes);
  if (allowed.length > 0 && !allowed.includes(ext)) {
    return `Please upload a ${allowed.join(", ")} file.`;
  }
  const acceptedMimes = MIME_BY_EXT[ext];
  if (acceptedMimes && input.mimeType && !acceptedMimes.includes(input.mimeType) && input.mimeType !== "application/octet-stream") {
    return "The file type does not match the file name.";
  }
  return null;
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isVideoMime(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

export function isPdfMime(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

export function isAudioMime(mimeType: string): boolean {
  return mimeType.startsWith("audio/");
}
