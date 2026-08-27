import { env } from "../config/env";
import type { FileStorage } from "./file-storage";
import { localFileStorage } from "./local-file-storage";
import { r2FileStorage } from "./r2-file-storage";

export function getStorageProvider(): FileStorage {
  if (env.storageProvider === "r2") {
    return r2FileStorage;
  }
  return localFileStorage;
}

export const fileStorage: FileStorage = getStorageProvider();
export type { FileStorage, FileStoreInput, SignedUpload, StoredFile } from "./file-storage";
