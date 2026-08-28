import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const GENERATE_PLACEHOLDER = "postgresql://prisma:prisma@127.0.0.1:5432/prisma";

function parseEnvFile(envPath: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  if (!fs.existsSync(envPath)) {
    return parsed;
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
    if (!key || !value) {
      continue;
    }
    parsed[key] = value;
  }
  return parsed;
}

function isPrismaGenerate(): boolean {
  const args = process.argv.join(" ").toLowerCase();
  return args.includes("generate");
}

const envPath = [path.join(root, ".env"), path.join(process.cwd(), ".env")].find((candidate) =>
  fs.existsSync(candidate),
);
const parsed = envPath ? parseEnvFile(envPath) : {};

for (const [key, value] of Object.entries(parsed)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

const databaseUrl =
  parsed.LMS_DATABASE_URL ||
  process.env.LMS_DATABASE_URL ||
  parsed.DATABASE_URL ||
  process.env.DATABASE_URL ||
  (isPrismaGenerate() ? GENERATE_PLACEHOLDER : "");

if (!databaseUrl) {
  throw new Error(
    `No database URL in ${envPath ?? path.join(root, ".env")}. Set LMS_DATABASE_URL (Cursor/Prisma treat DATABASE_URL as empty).`,
  );
}

process.env.LMS_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  schema: path.join(root, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(root, "prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  engine: "classic",
  datasource: {
    url: databaseUrl,
  },
});
