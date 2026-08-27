import path from "path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

dotenv.config({ path: path.resolve(__dirname, ".env"), override: true });
if (process.env.LMS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.LMS_DATABASE_URL;
}

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    setupFiles: ["./tests/setup.ts"],
    env: {
      NODE_ENV: "test",
    },
  },
});
