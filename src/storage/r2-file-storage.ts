import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";
import { ApiError } from "../utils/api-error";
import type { FileStorage, FileStoreInput, SignedUpload, StoredFile } from "./file-storage";
import { assertSafeStorageKey, buildObjectKey } from "./object-keys";

function createClient(): S3Client {
  if (!env.r2) {
    throw new Error("Cloudflare R2 is not configured.");
  }
  return new S3Client({
    region: "auto",
    endpoint: env.r2.endpoint,
    credentials: {
      accessKeyId: env.r2.accessKeyId,
      secretAccessKey: env.r2.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function bucket(): string {
  if (!env.r2) {
    throw new Error("Cloudflare R2 is not configured.");
  }
  return env.r2.bucketName;
}

function expiresIn(seconds?: number): number {
  return seconds && seconds > 0 ? seconds : env.signedUrlExpiresSeconds;
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = createClient();
  }
  return client;
}

export const r2FileStorage: FileStorage = {
  provider: "r2",

  async save(input: FileStoreInput): Promise<StoredFile> {
    const key = input.key ?? buildObjectKey(input.folder, input.originalName, input.mimeType);
    try {
      await s3().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: input.buffer,
          ContentType: input.mimeType,
          ContentLength: input.size,
        }),
      );
    } catch (error) {
      throw new ApiError(502, "We couldn't store this file. Please try again.", "STORAGE_UNAVAILABLE", error);
    }
    return {
      key,
      url: null,
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.size,
      provider: "r2",
    };
  },

  async delete(key: string): Promise<void> {
    const safe = assertSafeStorageKey(key);
    try {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: safe }));
    } catch (error) {
      throw new ApiError(502, "We couldn't delete this file. Please try again.", "STORAGE_UNAVAILABLE", error);
    }
  },

  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: assertSafeStorageKey(key) }));
      const bytes = await response.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: assertSafeStorageKey(key) }));
      return true;
    } catch {
      return false;
    }
  },

  async signedDownloadUrl(key: string, options?: { expiresInSeconds?: number; fileName?: string; mimeType?: string }): Promise<string | null> {
    const command = new GetObjectCommand({
      Bucket: bucket(),
      Key: assertSafeStorageKey(key),
      ResponseContentType: options?.mimeType,
      ResponseContentDisposition: options?.fileName
        ? `inline; filename="${options.fileName.replace(/[\r\n"]/g, "")}"`
        : undefined,
    });
    return getSignedUrl(s3(), command, { expiresIn: expiresIn(options?.expiresInSeconds) });
  },

  async signedUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<SignedUpload | null> {
    const command = new PutObjectCommand({
      Bucket: bucket(),
      Key: assertSafeStorageKey(key),
      ContentType: contentType,
    });
    const seconds = expiresIn(expiresInSeconds);
    const url = await getSignedUrl(s3(), command, { expiresIn: seconds });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": contentType },
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    };
  },
};
