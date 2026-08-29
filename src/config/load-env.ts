import fs from "node:fs";
import path from "node:path";

const DATABASE_ENV_KEYS = new Set(["LMS_DATABASE_URL", "DATABASE_URL"]);

function parseEnvFile(envPath: string): Record<string, string> {
  const parsed: Record<string, string> = {};
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
    if (!key || !value) {
      continue;
    }
    parsed[key] = value;
  }

  return parsed;
}

export function loadBackendEnv(): string {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${envPath}`);
  }

  const fileSize = fs.statSync(envPath).size;
  if (fileSize === 0) {
    throw new Error(
      `${envPath} is empty on disk (0 bytes). Save the .env tab in the editor (Ctrl+S), then restart npm run dev.`,
    );
  }

  const parsed = parseEnvFile(envPath);

  for (const [key, value] of Object.entries(parsed)) {
    if (DATABASE_ENV_KEYS.has(key)) {
      continue;
    }
    process.env[key] = value;
  }

  const databaseUrl = parsed.LMS_DATABASE_URL || parsed.DATABASE_URL || "";

  if (!databaseUrl) {
    const keys = Object.keys(parsed).join(", ") || "(none)";
    throw new Error(
      `No LMS_DATABASE_URL in ${envPath}. Keys found: ${keys}. Uncomment or add LMS_DATABASE_URL, save the file, then restart.`,
    );
  }

  return databaseUrl;
}
