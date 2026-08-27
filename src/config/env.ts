import { loadBackendEnv } from "./load-env";

loadBackendEnv();

const nodeEnv = process.env.NODE_ENV ?? "development";

function required(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }

  return parsed;
}

function optionalString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

function r2Config() {
  const provider = (process.env.STORAGE_PROVIDER ?? "local").trim().toLowerCase() === "r2" ? "r2" : "local";
  if (provider !== "r2") {
    return { storageProvider: "local" as const, r2: null };
  }
  const accountId = required("R2_ACCOUNT_ID");
  return {
    storageProvider: "r2" as const,
    r2: {
      accountId,
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      bucketName: required("R2_BUCKET_NAME"),
      endpoint: optionalString("R2_ENDPOINT", `https://${accountId}.r2.cloudflarestorage.com`),
    },
  };
}

const storage = r2Config();

export const SESSION_COOKIE_NAME = "lms_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest: nodeEnv === "test",
  port: optionalNumber("PORT", 5000),
  databaseUrl: required("LMS_DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  corsOrigin: required("CORS_ORIGIN"),
  publicUrl: process.env.LMS_PUBLIC_URL?.replace(/\/$/, "") || "",
  storageProvider: storage.storageProvider,
  r2: storage.r2,
  signedUrlExpiresSeconds: optionalNumber("R2_SIGNED_URL_EXPIRES_SECONDS", 15 * 60),
  maxVideoUploadMb: optionalNumber("MAX_VIDEO_UPLOAD_MB", 250),
  maxDocumentUploadMb: optionalNumber("MAX_DOCUMENT_UPLOAD_MB", 25),
  maxImageUploadMb: optionalNumber("MAX_IMAGE_UPLOAD_MB", 10),
  maxAudioUploadMb: optionalNumber("MAX_AUDIO_UPLOAD_MB", 50),
  maxAvatarUploadMb: optionalNumber("MAX_AVATAR_UPLOAD_MB", 5),
  timezone: optionalString("LMS_TIMEZONE", "Asia/Kathmandu"),
  usageHeartbeatIntervalMs: optionalNumber("USAGE_HEARTBEAT_INTERVAL_MS", 45_000),
  usageInactivityThresholdMs: optionalNumber("USAGE_INACTIVITY_THRESHOLD_MS", 5 * 60 * 1000),
  usageMaxSessionMs: optionalNumber("USAGE_MAX_SESSION_MS", 4 * 60 * 60 * 1000),
  usageMaxChartTrainees: optionalNumber("USAGE_MAX_CHART_TRAINEES", 12),
} as const;
