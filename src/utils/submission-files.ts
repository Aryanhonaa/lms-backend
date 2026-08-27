const MIME_BY_EXT: Record<string, string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  zip: ["application/zip", "application/x-zip-compressed"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain"],
  csv: ["text/csv", "application/vnd.ms-excel"],
};

const BLOCKED_EXT = new Set(["exe", "bat", "cmd", "com", "msi", "js", "mjs", "cjs", "sh", "ps1", "dll", "apk"]);

export function parseAllowedExtensions(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

export function fileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

export function assertSafeUpload(fileName: string, mimeType: string, allowedTypes: string, maxBytes: number, size: number): string | null {
  if (size > maxBytes) {
    return `File is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  }
  const ext = fileExtension(fileName);
  if (!ext || BLOCKED_EXT.has(ext)) {
    return "This file type is not allowed.";
  }
  const allowed = parseAllowedExtensions(allowedTypes);
  if (allowed.length > 0 && !allowed.includes(ext)) {
    return `Please upload a ${allowed.join(", ")} file.`;
  }
  const acceptedMimes = MIME_BY_EXT[ext];
  if (acceptedMimes && mimeType && !acceptedMimes.includes(mimeType) && mimeType !== "application/octet-stream") {
    return "The file type does not match the file name.";
  }
  return null;
}

export function safeDownloadName(fileName: string): string {
  return fileName.replace(/[\r\n"]/g, "").slice(0, 180) || "submission-file";
}
