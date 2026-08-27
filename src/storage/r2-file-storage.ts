import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";
import { ApiError } from "../utils/api-error";
import { logger } from "../utils/logger";
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

function corsOrigins(): string[] {
  const origins = env.corsOrigin
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
  for (const extra of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
    if (!origins.includes(extra)) {
      origins.push(extra);
    }
  }
  return origins;
}

/** Browser PUT/GET of signed R2 URLs requires bucket CORS; missing rules surface as xhr network errors. */
export async function ensureR2BucketCors(): Promise<void> {
  if (!env.r2) {
    return;
  }
  try {
    await s3().send(
      new PutBucketCorsCommand({
        Bucket: bucket(),
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: corsOrigins(),
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag", "Content-Type", "Content-Length"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  } catch (error) {
    logger.warn("Could not apply R2 bucket CORS. Direct browser uploads may fail until CORS is set on the bucket.", error);
  }
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
