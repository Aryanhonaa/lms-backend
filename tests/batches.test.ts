import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { cookieFrom } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-run`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Run Admin", email: `run.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Run Trainer", email: `run.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  otherTrainer: { name: "Run Other Trainer", email: `run.othertrainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "Run Trainee", email: `run.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  traineeTwo: { name: "Run Trainee Two", email: `run.trainee2.${suffix}@lms.local`, role: Role.TRAINEE },
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

async function createSubmittedProgram(trainerCookie: string, title: string) {
  const created = await request(app).post("/api/v1/trainer/programs").set("Cookie", trainerCookie).send({
    title,
    description: "Reusable course",
    category: "Web",
    difficulty: "BEGINNER",
    durationWeeks: 1,
    trainingMode: "PROGRESSION",
  });
  expect(created.status).toBe(201);
  const programId = created.body.data.program.id as string;
  expect(
    (await request(app).post(`/api/v1/trainer/programs/${programId}/weeks`).set("Cookie", trainerCookie).send({ title: "Week 1" }))
      .status,
  ).toBe(200);
  expect((await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie)).status).toBe(200);
  return programId;
}

describe("course runs (batches) as independent offerings", () => {
  let passwordHash = "";

  beforeAll(async () => {
    passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.enrollment.deleteMany({
      where: { OR: [{ user: { email: { in: emails } } }, { user: { email: { startsWith: `fill.${suffix}.` } } }] },
    });
    await prisma.programBatch.deleteMany({ where: { program: { createdBy: { email: { in: emails } } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({
      where: { OR: [{ email: { in: emails } }, { email: { startsWith: `fill.${suffix}.` } }] },
    });
  });

  it("blocks runs on unapproved courses and lets the operating trainer create them after approval", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const draftCreated = await request(app).post("/api/v1/trainer/programs").set("Cookie", trainerCookie).send({
      title: `Draft course ${suffix}`,
      description: "Draft",
      category: "Web",
      difficulty: "BEGINNER",
      durationWeeks: 1,
      trainingMode: "PROGRESSION",
    });
    expect(draftCreated.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/v1/trainer/programs/${draftCreated.body.data.program.id}/batches`)
          .set("Cookie", trainerCookie)
          .send({ name: "September 2026" })
      ).status,
    ).toBe(400);

    const pendingId = await createSubmittedProgram(trainerCookie, `Pending course ${suffix}`);
    expect(
      (
        await request(app)
          .post(`/api/v1/trainer/programs/${pendingId}/batches`)
          .set("Cookie", trainerCookie)
          .send({ name: "September 2026" })
      ).status,
    ).toBe(400);

    const traineeForbidden = await request(app)
      .post(`/api/v1/trainer/programs/${pendingId}/batches`)
      .set("Cookie", await login(accounts.trainee.email))
      .send({ name: "Trainee run" });
    expect(traineeForbidden.status).toBe(403);
  });

  it("treats September and October as separate offerings of the same approved course", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const otherTrainerCookie = await login(accounts.otherTrainer.email);
    const trainee = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainee.email } });
    const traineeTwo = await prisma.user.findUniqueOrThrow({ where: { email: accounts.traineeTwo.email } });

    const programId = await createSubmittedProgram(trainerCookie, `Web Fundamentals ${suffix}`);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);

    const september = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/batches`)
      .set("Cookie", trainerCookie)
      .send({ name: "September 2026", capacity: 25 });
    expect(september.status).toBe(201);
    const septemberId = september.body.data.batch.id as string;
    expect(september.body.data.batch.capacity).toBe(25);
    expect(september.body.data.batch.memberCount).toBe(0);

    expect(
      (
        await request(app)
          .post(`/api/v1/trainer/programs/${programId}/batches`)
          .set("Cookie", otherTrainerCookie)
          .send({ name: "Should fail" })
      ).status,
    ).toBe(403);

    const october = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/batches`)
      .set("Cookie", trainerCookie)
      .send({ name: "October 2026", capacity: 25 });
    expect(october.status).toBe(201);
    const octoberId = october.body.data.batch.id as string;

    const enrolledSept = await request(app)
      .post(`/api/v1/trainer/batches/${septemberId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [trainee.id] });
    expect(enrolledSept.status).toBe(200);
    expect(enrolledSept.body.data.enrolledCount).toBe(1);

    const listed = await request(app).get(`/api/v1/trainer/programs/${programId}/batches`).set("Cookie", trainerCookie);
    expect(listed.status).toBe(200);
    const septRow = listed.body.data.batches.find((row: { id: string }) => row.id === septemberId);
    const octRow = listed.body.data.batches.find((row: { id: string }) => row.id === octoberId);
    expect(septRow.memberCount).toBe(1);
    expect(septRow.remaining).toBe(24);
    expect(octRow.memberCount).toBe(0);
    expect(octRow.remaining).toBe(25);

    const sameBatchAgain = await request(app)
      .post(`/api/v1/trainer/batches/${septemberId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [trainee.id] });
    expect(sameBatchAgain.body.data.alreadyEnrolledCount).toBe(1);

    const enrolledOct = await request(app)
      .post(`/api/v1/trainer/batches/${octoberId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [trainee.id] });
    expect(enrolledOct.status).toBe(200);
    expect(enrolledOct.body.data.enrolledCount).toBe(1);

    const rows = await prisma.enrollment.findMany({
      where: { programId, userId: trainee.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.batchId).sort()).toEqual([octoberId, septemberId].sort());

    await request(app)
      .post(`/api/v1/trainer/batches/${octoberId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [traineeTwo.id] });

    const blockedDelete = await request(app).delete(`/api/v1/trainer/batches/${septemberId}`).set("Cookie", trainerCookie);
    expect(blockedDelete.status).toBe(409);

    const septBoard = await request(app)
      .get(`/api/v1/trainer/leaderboard?programId=${programId}&batchId=${septemberId}`)
      .set("Cookie", trainerCookie);
    expect(septBoard.status).toBe(200);
    expect(septBoard.body.data.boards).toHaveLength(1);
    expect(septBoard.body.data.boards[0].batch.id).toBe(septemberId);
    expect(septBoard.body.data.boards[0].entries).toHaveLength(1);
    expect(septBoard.body.data.boards[0].entries[0].trainee.name).toBe(accounts.trainee.name);

    const octBoard = await request(app)
      .get(`/api/v1/trainer/leaderboard?programId=${programId}&batchId=${octoberId}`)
      .set("Cookie", trainerCookie);
    expect(octBoard.status).toBe(200);
    expect(octBoard.body.data.boards[0].entries).toHaveLength(2);

    const traineeCookie = await login(accounts.trainee.email);
    const otherBatch = await request(app)
      .get(`/api/v1/trainee/leaderboard?programId=${programId}&batchId=${octoberId}`)
      .set("Cookie", traineeCookie);
    expect(otherBatch.status).toBe(200);
    expect(otherBatch.body.data.boards[0].batch.id).toBe(octoberId);

    const septLearn = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/progress?batchId=${septemberId}`)
      .set("Cookie", traineeCookie);
    const octLearn = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/progress?batchId=${octoberId}`)
      .set("Cookie", traineeCookie);
    expect(septLearn.status).toBe(200);
    expect(octLearn.status).toBe(200);
    expect(septLearn.body.data.enrollment.id).not.toBe(octLearn.body.data.enrollment.id);
  });

  it("keeps capacity independent per batch", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const programId = await createSubmittedProgram(trainerCookie, `Capacity course ${suffix}`);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);

    const batchA = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/batches`)
      .set("Cookie", trainerCookie)
      .send({ name: "Full morning", capacity: 25 });
    expect(batchA.status).toBe(201);
    const batchB = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/batches`)
      .set("Cookie", trainerCookie)
      .send({ name: "Open evening", capacity: 25 });
    expect(batchB.status).toBe(201);

    await prisma.user.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        name: `Fill ${index}`,
        email: `fill.${suffix}.${index}@lms.local`,
        role: Role.TRAINEE,
        passwordHash,
      })),
    });
    const fillers = await prisma.user.findMany({ where: { email: { startsWith: `fill.${suffix}.` } } });
    expect(fillers).toHaveLength(25);
    await prisma.enrollment.createMany({
      data: fillers.map((user) => ({
        programId,
        userId: user.id,
        batchId: batchA.body.data.batch.id as string,
      })),
    });

    const traineeTwo = await prisma.user.findUniqueOrThrow({ where: { email: accounts.traineeTwo.email } });
    const overflow = await request(app)
      .post(`/api/v1/trainer/batches/${batchA.body.data.batch.id}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [traineeTwo.id] });
    expect(overflow.status).toBe(200);
    expect(overflow.body.data.enrolledCount).toBe(0);
    expect(overflow.body.data.skippedCount).toBe(1);
    expect(overflow.body.data.skipped[0].reason).toMatch(/capacity/i);

    const intoOpen = await request(app)
      .post(`/api/v1/trainer/batches/${batchB.body.data.batch.id}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [traineeTwo.id] });
    expect(intoOpen.status).toBe(200);
    expect(intoOpen.body.data.enrolledCount).toBe(1);
  });
});
