import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { cookieFrom } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-trainer-dash`;
const password = "TestPass123!";

const accounts = {
  trainerA: { name: "Dash Trainer A", email: `dash.trainer.a.${suffix}@lms.local`, role: Role.TRAINER },
  trainerB: { name: "Dash Trainer B", email: `dash.trainer.b.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "Dash Trainee", email: `dash.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("trainer dashboard", () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.assignmentSubmission.deleteMany({ where: { enrollment: { user: { email: { in: emails } } } } });
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("returns trainer-scoped live metrics and hides other trainers' programs", async () => {
    const cookieA = await login(accounts.trainerA.email);
    const cookieB = await login(accounts.trainerB.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", cookieA)
      .send({
        title: `Scoped Dashboard Program ${suffix}`,
        description: "Used to verify trainer dashboard scoping",
        category: "Security",
        difficulty: "BEGINNER",
        durationWeeks: 4,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;

    const dashboardA = await request(app).get("/api/v1/trainer/dashboard?range=week").set("Cookie", cookieA);
    expect(dashboardA.status).toBe(200);
    expect(dashboardA.body.success).toBe(true);
    expect(dashboardA.body.data.dashboard.statistics.programs.total).toBeGreaterThanOrEqual(1);
    expect(dashboardA.body.data.dashboard.programs.some((row: { id: string }) => row.id === programId)).toBe(true);

    const dashboardB = await request(app).get("/api/v1/trainer/dashboard").set("Cookie", cookieB);
    expect(dashboardB.status).toBe(200);
    expect(dashboardB.body.data.dashboard.programs.some((row: { id: string }) => row.id === programId)).toBe(false);

    const searchA = await request(app)
      .get(`/api/v1/trainer/search?q=${encodeURIComponent("Scoped Dashboard")}`)
      .set("Cookie", cookieA);
    expect(searchA.status).toBe(200);
    expect(searchA.body.data.programs.some((row: { id: string }) => row.id === programId)).toBe(true);

    const searchB = await request(app)
      .get(`/api/v1/trainer/search?q=${encodeURIComponent("Scoped Dashboard")}`)
      .set("Cookie", cookieB);
    expect(searchB.status).toBe(200);
    expect(searchB.body.data.programs.some((row: { id: string }) => row.id === programId)).toBe(false);
  });

  it("forbids non-trainers from the trainer dashboard", async () => {
    const traineeCookie = await login(accounts.trainee.email);
    const response = await request(app).get("/api/v1/trainer/dashboard").set("Cookie", traineeCookie);
    expect(response.status).toBe(403);
  });
});
