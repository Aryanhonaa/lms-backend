import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { cookieFrom, enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-trainee-dash`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Trainee Dash Admin", email: `trainee.dash.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Trainee Dash Trainer", email: `trainee.dash.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  traineeA: { name: "Trainee Dash A", email: `trainee.dash.a.${suffix}@lms.local`, role: Role.TRAINEE },
  traineeB: { name: "Trainee Dash B", email: `trainee.dash.b.${suffix}@lms.local`, role: Role.TRAINEE },
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("trainee dashboard", () => {
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

  it("returns trainee-scoped dashboard data and hides other trainees' programs", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const cookieA = await login(accounts.traineeA.email);
    const cookieB = await login(accounts.traineeB.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: `Trainee Dashboard Program ${suffix}`,
        description: "Used to verify trainee dashboard scoping",
        category: "Security",
        difficulty: "BEGINNER",
        durationWeeks: 4,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;

    const week = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    expect(week.status).toBe(200);
    expect((await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie)).status).toBe(200);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);

    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.traineeA.email);

    const dashboardA = await request(app).get("/api/v1/trainee/dashboard?range=week").set("Cookie", cookieA);
    expect(dashboardA.status).toBe(200);
    expect(dashboardA.body.success).toBe(true);
    expect(dashboardA.body.data.dashboard.statistics.enrolledPrograms.total).toBeGreaterThanOrEqual(1);
    expect(dashboardA.body.data.dashboard.currentLearning?.program.id).toBe(programId);

    const dashboardB = await request(app).get("/api/v1/trainee/dashboard").set("Cookie", cookieB);
    expect(dashboardB.status).toBe(200);
    expect(dashboardB.body.data.dashboard.statistics.enrolledPrograms.total).toBe(0);
    expect(dashboardB.body.data.dashboard.currentLearning).toBeNull();

    const searchA = await request(app)
      .get(`/api/v1/trainee/search?q=${encodeURIComponent("Trainee Dashboard")}`)
      .set("Cookie", cookieA);
    expect(searchA.status).toBe(200);
    expect(searchA.body.data.programs.some((row: { id: string }) => row.id === programId)).toBe(true);

    const searchB = await request(app)
      .get(`/api/v1/trainee/search?q=${encodeURIComponent("Trainee Dashboard")}`)
      .set("Cookie", cookieB);
    expect(searchB.status).toBe(200);
    expect(searchB.body.data.programs.some((row: { id: string }) => row.id === programId)).toBe(false);
  });

  it("forbids trainers from the trainee dashboard", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const response = await request(app).get("/api/v1/trainee/dashboard").set("Cookie", trainerCookie);
    expect(response.status).toBe(403);
  });
});
