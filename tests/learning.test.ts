import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-p4`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "P4 Admin", email: `phase4.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "P4 Trainer", email: `phase4.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "P4 Trainee", email: `phase4.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
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

describe("trainee learning experience", () => {
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

  it("enrolls a trainee after approval, locks later weeks, and persists completion", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Foundations Track",
        description: "Two-week progression program",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 2,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;

    const week1Res = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    expect(week1Res.status).toBe(200);
    const week1Id = week1Res.body.data.program.weeks[0].id as string;

    const week2Res = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 2" });
    expect(week2Res.status).toBe(200);
    const weeks = week2Res.body.data.program.weeks as Array<{ id: string; title: string }>;
    const week2Id = weeks.find((week) => week.title === "Week 2")!.id;

    const day1Res = await request(app)
      .post(`/api/v1/trainer/weeks/${week1Id}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    expect(day1Res.status).toBe(200);
    const day1Id = day1Res.body.data.program.weeks.find((week: { id: string }) => week.id === week1Id).days[0]
      .id as string;

    const day2Res = await request(app)
      .post(`/api/v1/trainer/weeks/${week2Id}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    expect(day2Res.status).toBe(200);
    const day2Id = day2Res.body.data.program.weeks.find((week: { id: string }) => week.id === week2Id).days[0]
      .id as string;

    const lesson1 = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Welcome", description: "Start here", durationMin: 10 });
    expect(lesson1.status).toBe(200);

    const video1 = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/videos`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Intro video",
        source: "YOUTUBE",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        durationMin: 5,
      });
    expect(video1.status).toBe(200);

    const resource1 = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/resources`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Optional reading",
        url: "https://example.com/guide",
        kind: "ARTICLE",
        required: false,
      });
    expect(resource1.status).toBe(200);

    const reel1 = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/reels`)
      .set("Cookie", trainerCookie)
      .send({ title: "Quick clip", url: "https://example.com/reel.mp4", durationSec: 30 });
    expect(reel1.status).toBe(200);

    const lesson2 = await request(app)
      .post(`/api/v1/trainer/days/${day2Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Advanced notes", description: "SECRET_INTERNALS", durationMin: 20 });
    expect(lesson2.status).toBe(200);

    const submitted = await request(app)
      .post(`/api/v1/programs/${programId}/submit`)
      .set("Cookie", trainerCookie);
    expect(submitted.status).toBe(200);

    const approved = await request(app)
      .post(`/api/v1/programs/${programId}/approve`)
      .set("Cookie", adminCookie);
    expect(approved.status).toBe(200);

    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const enrollments = await request(app).get("/api/v1/trainee/enrollments").set("Cookie", traineeCookie);
    expect(enrollments.status).toBe(200);
    expect(enrollments.body.data.enrollments.some((row: { program: { id: string } }) => row.program.id === programId)).toBe(
      true,
    );

    const learn = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/learn`)
      .set("Cookie", traineeCookie);
    expect(learn.status).toBe(200);

    const week2 = learn.body.data.weeks.find((week: { title: string }) => week.title === "Week 2");
    expect(week2.status).toBe("LOCKED");
    expect(week2.reason).toBe("Complete Week 1 before accessing this content.");

    const lockedLesson = week2.days[0].items.find((item: { type: string }) => item.type === "LESSON");
    expect(lockedLesson.status).toBe("LOCKED");
    expect(lockedLesson.description).toBeUndefined();
    expect(lockedLesson.url).toBeUndefined();

    const lockedDetail = await request(app)
      .get(`/api/v1/trainee/items/LESSON/${lockedLesson.id}`)
      .set("Cookie", traineeCookie);
    expect(lockedDetail.status).toBe(200);
    expect(lockedDetail.body.data.item.description).toBeUndefined();
    expect(JSON.stringify(lockedDetail.body)).not.toContain("SECRET_INTERNALS");

    const lockedComplete = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${lockedLesson.id}/complete`)
      .set("Cookie", traineeCookie);
    expect(lockedComplete.status).toBe(403);

    const week1 = learn.body.data.weeks.find((week: { title: string }) => week.title === "Week 1");
    const week1Items = week1.days[0].items as Array<{ id: string; type: string; required: boolean }>;
    const requiredItems = week1Items.filter((item) => item.required);

    for (const item of requiredItems) {
      const completed = await request(app)
        .post(`/api/v1/trainee/items/${item.type}/${item.id}/complete`)
        .set("Cookie", traineeCookie);
      expect(completed.status).toBe(200);
    }

    const after = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/learn`)
      .set("Cookie", traineeCookie);
    expect(after.status).toBe(200);
    const unlockedWeek2 = after.body.data.weeks.find((week: { title: string }) => week.title === "Week 2");
    expect(unlockedWeek2.status).toBe("AVAILABLE");
    const unlockedLesson = unlockedWeek2.days[0].items.find((item: { type: string }) => item.type === "LESSON");
    expect(unlockedLesson.status).toBe("AVAILABLE");
    expect(unlockedLesson.description).toBe("SECRET_INTERNALS");

    const finish = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${unlockedLesson.id}/complete`)
      .set("Cookie", traineeCookie);
    expect(finish.status).toBe(200);
    expect(finish.body.data.progress.percent).toBe(100);

    const stored = await prisma.contentCompletion.findMany({
      where: { enrollmentId: after.body.data.enrollment.id },
    });
    expect(stored.length).toBeGreaterThanOrEqual(requiredItems.length + 1);
    expect(stored.some((row) => row.itemId === unlockedLesson.id && row.itemType === "LESSON")).toBe(true);
  });
});
