import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * Frontend calls these paths. Unauthenticated requests must not 404 —
 * they should hit auth/role middleware (401/403) so the route exists.
 */
const REQUIRED: Array<{ method: "get" | "post"; path: string }> = [
  { method: "get", path: "/api/v1/trainer/grading-queue" },
  { method: "get", path: "/api/v1/trainer/grading-queue/count" },
  { method: "post", path: "/api/v1/trainer/attempts/00000000-0000-4000-8000-000000000001/grade" },
  { method: "post", path: "/api/v1/trainer/programs/00000000-0000-4000-8000-000000000001/duplicate" },
  { method: "get", path: "/api/v1/trainer/calendar" },
  { method: "get", path: "/api/v1/trainer/assessments" },
  { method: "get", path: "/api/v1/trainer/batch-tracker" },
  { method: "get", path: "/api/v1/admin/calendar" },
  { method: "get", path: "/api/v1/trainee/calendar" },
];

describe("API route contract", () => {
  const app = createApp();

  it.each(REQUIRED)("$method $path is registered (not 404)", async ({ method, path }) => {
    const response =
      method === "get" ? await request(app).get(path) : await request(app).post(path).send({});
    expect(response.status, `${method.toUpperCase()} ${path} returned ${response.status}`).not.toBe(404);
    expect([401, 403]).toContain(response.status);
  });
});
