import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorage, FileStoreInput, SignedUpload, StoredFile } from "./file-storage";
import { assertSafeStorageKey, buildObjectKey } from "./object-keys";

const PUBLIC_ROOT = path.resolve(process.cwd(), "uploads");
const PRIVATE_ROOT = path.resolve(process.cwd(), "storage");

function resolvePath(key: string, visibility: "public" | "private"): string {
  const safe = assertSafeStorageKey(key);
  const root = visibility === "private" ? PRIVATE_ROOT : PUBLIC_ROOT;
  const destination = path.resolve(root, safe);
  if (!destination.startsWith(root)) {
    throw new Error("Invalid storage key");
  }
  return destination;
}

/**
 * A key alone cannot tell us which root holds the file: legacy public uploads and
 * private curriculum media share the same prefixes, so both roots are checked.
 */
function candidatePaths(key: string): string[] {
  return [resolvePath(key, "private"), resolvePath(key, "public")];
}

async function firstExistingPath(key: string): Promise<string | null> {
  for (const candidate of candidatePaths(key)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export const localFileStorage: FileStorage = {
  provider: "local",

  async save(input: FileStoreInput, publicOrigin: string): Promise<StoredFile> {
    const visibility = input.visibility ?? (input.folder.startsWith("submissions") || input.folder.startsWith("certificates") ? "private" : "public");
    const key = input.key ?? buildObjectKey(input.folder, input.originalName, input.mimeType);
    const destination = resolvePath(key, visibility);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, input.buffer);
    const origin = publicOrigin.replace(/\/$/, "");
    return {
      key,
      url: visibility === "public" && origin ? `${origin}/uploads/${key}` : null,
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.size,
      provider: "local",
    };
  },

  async delete(key: string): Promise<void> {
    for (const candidate of candidatePaths(key)) {
      await unlink(candidate).catch(() => undefined);
    }
  },

  async get(key: string): Promise<Buffer | null> {
    const found = await firstExistingPath(key);
    if (!found) {
      return null;
    }
    return readFile(found).catch(() => null);
  },

  async exists(key: string): Promise<boolean> {
    return (await firstExistingPath(key)) !== null;
  },

  async signedDownloadUrl(): Promise<string | null> {
    return null;
  },

  async signedUploadUrl(): Promise<SignedUpload | null> {
    return null;
  },
};
