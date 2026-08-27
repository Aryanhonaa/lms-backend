import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";

const app = createApp();
const suffix = `${Date.now()}-dash`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Dash Admin", email: `dash.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Dash Trainer", email: `dash.trainer.${suffix}@lms.local`, role: Role.TRAINER },
};

function cookieFrom(response: request.Response): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const session = cookies.find((value) => value.startsWith("lms_session="));
  if (!session) {
    throw new Error("Missing session cookie");
  }
  return session.split(";")[0];
}

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("admin dashboard", () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("returns live metrics for super admins and forbids trainers", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);

    const forbidden = await request(app).get("/api/v1/admin/dashboard").set("Cookie", trainerCookie);
    expect(forbidden.status).toBe(403);

    const before = await request(app).get("/api/v1/admin/dashboard").set("Cookie", adminCookie);
    expect(before.status).toBe(200);
    expect(before.body.success).toBe(true);
    expect(before.body.data.dashboard.metrics).toMatchObject({
      courses: { total: expect.any(Number), addedThisMonth: expect.any(Number) },
      trainees: { total: expect.any(Number), addedThisMonth: expect.any(Number) },
      trainers: { total: expect.any(Number), pending: expect.any(Number) },
      pendingApprovals: { total: expect.any(Number) },
    });

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: `Dashboard Course ${suffix}`,
        description: "Used to verify admin metrics",
        category: "Design",
        difficulty: "BEGINNER",
        durationWeeks: 2,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;

    const after = await request(app).get("/api/v1/admin/dashboard").set("Cookie", adminCookie);
    expect(after.status).toBe(200);
    expect(after.body.data.dashboard.metrics.courses.total).toBe(before.body.data.dashboard.metrics.courses.total);

    const catalog = await request(app).get("/api/v1/admin/programs?view=all").set("Cookie", adminCookie);
    expect(catalog.body.data.programs.some((item: { id: string }) => item.id === programId)).toBe(false);
  });
});
