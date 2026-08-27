import fs from "node:fs";
import path from "node:path";

export function loadBackendEnv(): string {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${envPath}`);
  }

  const text = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }

  const databaseUrl = process.env.LMS_DATABASE_URL || process.env.DATABASE_URL || "";

  if (!databaseUrl) {
    throw new Error(`No database URL in ${envPath}. Set LMS_DATABASE_URL.`);
  }

  process.env.LMS_DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL = databaseUrl;

  return databaseUrl;
}
