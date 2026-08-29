import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { appUsageService } from "../src/services/app-usage.service";
import { hashPassword } from "../src/utils/password";
import { startOfZonedDay, wallClockInZoneToUtc } from "../src/utils/timezone";
import type { AuthUser } from "../src/types";
import { cookieFrom, enrollTraineeByEmail, ensureTestBatch } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-usage`;
const password = "TestPass123!";

const accounts = {
  superAdmin: { name: "Usage Super", email: `usage.super.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  admin: { name: "Usage Admin", email: `usage.admin.${suffix}@lms.local`, role: Role.ADMIN },
  trainer: { name: "Usage Trainer", email: `usage.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  otherTrainer: { name: "Usage Other Trainer", email: `usage.othertrainer.${suffix}@lms.local`, role: Role.TRAINER },
  aryan: { name: "Aryan", email: `usage.aryan.${suffix}@lms.local`, role: Role.TRAINEE },
  john: { name: "John", email: `usage.john.${suffix}@lms.local`, role: Role.TRAINEE },
  sarah: { name: "Sarah", email: `usage.sarah.${suffix}@lms.local`, role: Role.TRAINEE },
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

async function createApprovedProgram(trainerCookie: string, adminCookie: string, title: string) {
  const created = await request(app)
    .post("/api/v1/trainer/programs")
    .set("Cookie", trainerCookie)
    .send({
      title,
      description: "App usage analytics program",
      category: "Web",
      difficulty: "BEGINNER",
      durationWeeks: 1,
      trainingMode: "PROGRESSION",
    });
  expect(created.status).toBe(201);
  const programId = created.body.data.program.id as string;
  expect((await request(app).post(`/api/v1/trainer/programs/${programId}/weeks`).set("Cookie", trainerCookie).send({ title: "Week 1" })).status).toBe(200);
  expect((await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie)).status).toBe(200);
  expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);
  return programId;
}

function asAuthUser(row: { id: string; name: string; email: string; role: Role; avatarUrl?: string | null; createdAt: Date }): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatarUrl ?? null,
    createdAt: row.createdAt,
  };
}

describe("timezone helpers", () => {
  it("places Nepal midnight on the previous UTC evening", () => {
    const start = startOfZonedDay(2026, 8, 26, "Asia/Kathmandu");
    expect(start.toISOString()).toBe("2026-08-25T18:15:00.000Z");
    const wall = wallClockInZoneToUtc(2026, 8, 26, 9, 0, 0, "Asia/Kathmandu");
    expect(wall.toISOString()).toBe("2026-08-26T03:15:00.000Z");
  });
});

describe("app usage tracking and analytics", () => {
  let users: Record<keyof typeof accounts, { id: string; name: string; email: string; role: Role; avatarUrl: string | null; createdAt: Date }>;
  let septemberId: string;
  let octoberId: string;
  let otherProgramId: string;
  let otherBatchId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });
    const rows = await prisma.user.findMany({ where: { email: { in: Object.values(accounts).map((row) => row.email) } } });
    users = Object.fromEntries(
      (Object.keys(accounts) as Array<keyof typeof accounts>).map((key) => {
        const row = rows.find((item) => item.email === accounts[key].email);
        if (!row) {
          throw new Error(`Missing user ${accounts[key].email}`);
        }
        return [key, row];
      }),
    ) as typeof users;

    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const otherTrainerCookie = await login(accounts.otherTrainer.email);
    const programId = await createApprovedProgram(trainerCookie, adminCookie, `Usage Program ${suffix}`);
    otherProgramId = await createApprovedProgram(otherTrainerCookie, adminCookie, `Usage Other Program ${suffix}`);
    septemberId = await ensureTestBatch(app, trainerCookie, programId, "September 2026");
    octoberId = await ensureTestBatch(app, trainerCookie, programId, "October 2026");
    otherBatchId = await ensureTestBatch(app, otherTrainerCookie, otherProgramId, "Other Batch");

    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.aryan.email, septemberId);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.john.email, septemberId);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.aryan.email, octoberId);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.sarah.email, octoberId);
    await enrollTraineeByEmail(app, otherTrainerCookie, otherProgramId, accounts.sarah.email, otherBatchId);

    const dayStart = startOfZonedDay(2026, 8, 26, env.timezone);
    await prisma.appUsageSession.createMany({
      data: [
        {
          userId: users.aryan.id,
          startedAt: new Date(dayStart.getTime() + 9 * 3600_000),
          lastHeartbeatAt: new Date(dayStart.getTime() + 9 * 3600_000 + 2 * 3600_000 + 35 * 60_000),
          endedAt: new Date(dayStart.getTime() + 9 * 3600_000 + 2 * 3600_000 + 35 * 60_000),
          durationSeconds: 2 * 3600 + 35 * 60,
        },
        {
          userId: users.john.id,
          startedAt: new Date(dayStart.getTime() + 10 * 3600_000),
          lastHeartbeatAt: new Date(dayStart.getTime() + 10 * 3600_000 + 1 * 3600_000 + 48 * 60_000),
          endedAt: new Date(dayStart.getTime() + 10 * 3600_000 + 1 * 3600_000 + 48 * 60_000),
          durationSeconds: 1 * 3600 + 48 * 60,
        },
        {
          userId: users.sarah.id,
          startedAt: new Date(dayStart.getTime() + 11 * 3600_000),
          lastHeartbeatAt: new Date(dayStart.getTime() + 11 * 3600_000 + 1 * 3600_000 + 12 * 60_000),
          endedAt: new Date(dayStart.getTime() + 11 * 3600_000 + 1 * 3600_000 + 12 * 60_000),
          durationSeconds: 1 * 3600 + 12 * 60,
        },
      ],
    });
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.appUsageSession.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("records active usage, updates heartbeats, and ignores client duration", async () => {
    const cookie = await login(accounts.aryan.email);
    const rejected = await request(app)
      .post("/api/v1/trainee/usage/heartbeat")
      .set("Cookie", cookie)
      .send({ duration: 999999, durationSeconds: 999999 });
    expect(rejected.status).toBe(400);

    const first = await request(app).post("/api/v1/trainee/usage/heartbeat").set("Cookie", cookie).send({});
    expect(first.status).toBe(200);
    expect(first.body.data.active).toBe(true);

    const second = await request(app).post("/api/v1/trainee/usage/heartbeat").set("Cookie", cookie).send({});
    expect(second.status).toBe(200);
    expect(second.body.data.startedAt).toBe(first.body.data.startedAt);

    const open = await prisma.appUsageSession.findMany({
      where: { userId: users.aryan.id, endedAt: null },
    });
    expect(open).toHaveLength(1);
    expect(open[0]?.durationSeconds).toBeLessThan(60);

    await request(app).post("/api/v1/trainee/usage/end").set("Cookie", cookie);
    await prisma.appUsageSession.deleteMany({
      where: { userId: users.aryan.id, durationSeconds: { not: 2 * 3600 + 35 * 60 } },
    });
  });

  it("stops accumulating after the inactivity threshold", async () => {
    const trainee = asAuthUser(users.john);
    const t0 = new Date("2026-08-20T03:00:00.000Z");
    await appUsageService.heartbeat(trainee, {}, t0);
    await appUsageService.heartbeat(trainee, {}, new Date(t0.getTime() + 45_000));
    await appUsageService.heartbeat(trainee, {}, new Date(t0.getTime() + 6 * 60_000));

    const sessions = await prisma.appUsageSession.findMany({
      where: { userId: users.john.id, startedAt: { gte: t0 } },
      orderBy: { startedAt: "asc" },
    });
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const closed = sessions.find((row) => row.endedAt);
    expect(closed?.durationSeconds).toBe(45);
    expect(closed?.durationSeconds).toBeLessThan(6 * 60);
  });

  it("returns daily, weekly, and monthly analytics for super admin", async () => {
    const cookie = await login(accounts.superAdmin.email);
    const daily = await request(app)
      .get("/api/v1/admin/analytics/app-usage?period=daily&date=2026-08-26")
      .set("Cookie", cookie);
    expect(daily.status).toBe(200);
    const rows = daily.body.data.analytics.trainees as Array<{ name: string; seconds: number }>;
    const byName = Object.fromEntries(rows.map((row) => [row.name, row.seconds]));
    expect(byName.Aryan).toBe(2 * 3600 + 35 * 60);
    expect(byName.John).toBe(1 * 3600 + 48 * 60);
    expect(byName.Sarah).toBe(1 * 3600 + 12 * 60);
    expect(daily.body.data.analytics.summary.totalSeconds).toBeGreaterThanOrEqual(2 * 3600 + 35 * 60);
    expect(daily.body.data.analytics.range.label).toContain("August 26");

    const weekly = await request(app)
      .get("/api/v1/admin/analytics/app-usage?period=weekly&date=2026-08-26")
      .set("Cookie", cookie);
    expect(weekly.status).toBe(200);
    expect(weekly.body.data.analytics.buckets).toHaveLength(7);
    const aryanWeek = (weekly.body.data.analytics.trainees as Array<{ name: string; seconds: number }>).find((row) => row.name === "Aryan");
    expect(aryanWeek?.seconds).toBeGreaterThanOrEqual(2 * 3600 + 35 * 60);

    const monthly = await request(app)
      .get("/api/v1/admin/analytics/app-usage?period=monthly&date=2026-08-01")
      .set("Cookie", cookie);
    expect(monthly.status).toBe(200);
    expect(monthly.body.data.analytics.range.label).toBe("August 2026");
    expect(monthly.body.data.analytics.buckets.length).toBeGreaterThanOrEqual(4);
  });

  it("does not let a trainee view usage analytics", async () => {
    const cookie = await login(accounts.aryan.email);
    const own = await request(app)
      .get("/api/v1/trainee/analytics/app-usage?period=daily&date=2026-08-26")
      .set("Cookie", cookie);
    expect(own.status).toBe(404);

    const forbidden = await request(app)
      .get(`/api/v1/trainee/analytics/app-usage?traineeId=${users.sarah.id}&date=2026-08-26`)
      .set("Cookie", cookie);
    expect(forbidden.status).toBe(404);
  });

  it("scopes trainer analytics to authorized enrollments and batches", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const otherCookie = await login(accounts.otherTrainer.email);

    const september = await request(app)
      .get(`/api/v1/trainer/analytics/app-usage?period=daily&date=2026-08-26&batchId=${septemberId}`)
      .set("Cookie", trainerCookie);
    expect(september.status).toBe(200);
    const septemberNames = (september.body.data.analytics.trainees as Array<{ name: string }>).map((row) => row.name);
    expect(septemberNames).toEqual(expect.arrayContaining(["Aryan", "John"]));
    expect(septemberNames).not.toContain("Sarah");

    const unauthorized = await request(app)
      .get(`/api/v1/trainer/analytics/app-usage?period=daily&date=2026-08-26&traineeId=${users.sarah.id}&batchId=${septemberId}`)
      .set("Cookie", trainerCookie);
    expect(unauthorized.status).toBe(404);

    const otherSeesSarah = await request(app)
      .get(`/api/v1/trainer/analytics/app-usage?period=daily&date=2026-08-26`)
      .set("Cookie", otherCookie);
    expect(otherSeesSarah.status).toBe(200);
    const otherNames = (otherSeesSarah.body.data.analytics.trainees as Array<{ name: string }>).map((row) => row.name);
    expect(otherNames).toContain("Sarah");
    expect(otherNames).not.toContain("Aryan");
    expect(otherNames).not.toContain("John");
  });

  it("lets admin view org-wide usage and rejects empty-period vanity zeros", async () => {
    const cookie = await login(accounts.admin.email);
    const response = await request(app)
      .get("/api/v1/admin/analytics/app-usage?period=daily&date=2026-08-26")
      .set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.data.analytics.summary.activeTrainees).toBeGreaterThanOrEqual(3);

    const empty = await request(app)
      .get("/api/v1/admin/analytics/app-usage?period=daily&date=2025-01-01")
      .set("Cookie", cookie);
    expect(empty.status).toBe(200);
    expect(empty.body.data.analytics.summary.totalSeconds).toBe(0);
    expect(empty.body.data.analytics.summary.activeTrainees).toBe(0);
    expect(empty.body.data.analytics.summary.mostActive).toBeNull();
  });

  it("returns usage config to trainees and blocks other roles from heartbeats", async () => {
    const traineeCookie = await login(accounts.aryan.email);
    const trainerCookie = await login(accounts.trainer.email);
    const config = await request(app).get("/api/v1/trainee/usage/config").set("Cookie", traineeCookie);
    expect(config.status).toBe(200);
    expect(config.body.data.config.heartbeatIntervalMs).toBe(env.usageHeartbeatIntervalMs);
    expect(config.body.data.config.inactivityThresholdMs).toBe(env.usageInactivityThresholdMs);

    expect((await request(app).post("/api/v1/trainee/usage/heartbeat").set("Cookie", trainerCookie).send({})).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/analytics/app-usage").set("Cookie", traineeCookie)).status).toBe(403);
  });
});
