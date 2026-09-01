import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { cookieFrom, enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-enroll`;
const password = "TestPass123!";

const accounts = {
  superAdmin: { name: "Enroll Super", email: `enroll.super.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  admin: { name: "Enroll Admin", email: `enroll.admin.${suffix}@lms.local`, role: Role.ADMIN },
  trainer: { name: "Enroll Trainer", email: `enroll.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  otherTrainer: { name: "Enroll Other Trainer", email: `enroll.othertrainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "Enroll Trainee", email: `enroll.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  traineeTwo: { name: "Enroll Trainee Two", email: `enroll.trainee2.${suffix}@lms.local`, role: Role.TRAINEE },
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

async function createSubmittedProgram(trainerCookie: string, title: string) {
  const created = await request(app)
    .post("/api/v1/trainer/programs")
    .set("Cookie", trainerCookie)
    .send({
      title,
      description: "Enrollment rule program",
      category: "Web",
      difficulty: "BEGINNER",
      durationWeeks: 1,
      trainingMode: "PROGRESSION",
    });
  expect(created.status).toBe(201);
  const programId = created.body.data.program.id as string;
  const week = await request(app)
    .post(`/api/v1/trainer/programs/${programId}/weeks`)
    .set("Cookie", trainerCookie)
    .send({ title: "Week 1" });
  expect(week.status).toBe(200);
  const submitted = await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
  expect(submitted.status).toBe(200);
  return programId;
}

describe("admin role, approval, and trainer enrollment", () => {
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

  it("routes each role to the matching APIs and lets admin approve without enrolling", async () => {
    const superCookie = await login(accounts.superAdmin.email);
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const traineeCookie = await login(accounts.trainee.email);

    expect((await request(app).get("/api/v1/admin/dashboard").set("Cookie", superCookie)).status).toBe(200);
    expect((await request(app).get("/api/v1/admin/dashboard").set("Cookie", adminCookie)).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/operations").set("Cookie", adminCookie)).status).toBe(200);
    expect((await request(app).get("/api/v1/admin/users").set("Cookie", adminCookie)).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/trainees").set("Cookie", adminCookie)).status).toBe(200);
    expect((await request(app).get("/api/v1/trainer/programs").set("Cookie", trainerCookie)).status).toBe(200);
    expect((await request(app).get("/api/v1/trainee/enrollments").set("Cookie", traineeCookie)).status).toBe(200);
    expect((await request(app).get("/api/v1/admin/operations").set("Cookie", trainerCookie)).status).toBe(403);

    const programId = await createSubmittedProgram(trainerCookie, `Pending ${suffix}`);
    const approved = await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    expect(approved.status).toBe(200);
    expect(approved.body.data.program.status).toBe("APPROVED");

    const enrollments = await prisma.enrollment.count({ where: { programId } });
    expect(enrollments).toBe(0);

    const adminEnroll = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/enrollments`)
      .set("Cookie", adminCookie)
      .send({ traineeIds: [(await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainee.email } })).id] });
    expect(adminEnroll.status).toBe(403);
  });

  it("lets a trainer enroll trainees into an authorized approved program and blocks invalid targets", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const otherTrainerCookie = await login(accounts.otherTrainer.email);
    const traineeCookie = await login(accounts.trainee.email);
    const otherTraineeCookie = await login(accounts.traineeTwo.email);

    const programId = await createSubmittedProgram(trainerCookie, `Approved ${suffix}`);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);

    const trainee = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainee.email } });
    const trainer = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainer.email } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: accounts.admin.email } });
    const superAdmin = await prisma.user.findUniqueOrThrow({ where: { email: accounts.superAdmin.email } });

    const unauthorized = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/enrollments`)
      .set("Cookie", otherTrainerCookie)
      .send({ traineeIds: [trainee.id], batchId: "00000000-0000-0000-0000-000000000000" });
    expect(unauthorized.status).toBe(403);

    const batchId = (
      await request(app)
        .post(`/api/v1/trainer/programs/${programId}/batches`)
        .set("Cookie", trainerCookie)
        .send({ name: "September 2026", capacity: 25 })
    ).body.data.batch.id as string;

    const missingBatch = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [trainee.id] });
    expect(missingBatch.status).toBe(400);

    const blockedRoles = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [admin.id, trainer.id, superAdmin.id, trainee.id], batchId });
    expect(blockedRoles.status).toBe(200);
    expect(blockedRoles.body.data.enrolledCount).toBe(1);
    expect(blockedRoles.body.data.skippedCount).toBe(3);

    const duplicate = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [trainee.id], batchId });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.alreadyEnrolledCount).toBe(1);
    expect(duplicate.body.data.enrolledCount).toBe(0);

    const learn = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(learn.status).toBe(200);

    const peer = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", otherTraineeCookie);
    expect(peer.status).toBe(404);

    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.traineeTwo.email);

    const roster = await request(app)
      .get(`/api/v1/trainer/programs/${programId}/trainees`)
      .set("Cookie", trainerCookie);
    expect(roster.status).toBe(200);
    expect(roster.body.data.trainees).toHaveLength(2);

    const allTrainees = await request(app).get("/api/v1/trainer/trainees").set("Cookie", trainerCookie);
    expect(allTrainees.status).toBe(200);
    expect(allTrainees.body.data.trainees).toHaveLength(2);
    expect(allTrainees.body.data.programs.some((row: { id: string }) => row.id === programId)).toBe(true);

    const filteredTrainees = await request(app)
      .get(`/api/v1/trainer/trainees?programId=${programId}`)
      .set("Cookie", trainerCookie);
    expect(filteredTrainees.status).toBe(200);
    expect(filteredTrainees.body.data.trainees).toHaveLength(2);

    const otherProgramId = await createSubmittedProgram(otherTrainerCookie, `Other ${suffix}`);
    expect(
      (
        await request(app)
          .get(`/api/v1/trainer/trainees?programId=${otherProgramId}`)
          .set("Cookie", trainerCookie)
      ).status,
    ).toBe(403);

    const detail = await request(app).get(`/api/v1/admin/trainees/${trainee.id}`).set("Cookie", adminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.trainee.email).toBe(accounts.trainee.email);
    expect(detail.body.data.programs.some((row: { progress: { program: { id: string } } }) => row.progress.program.id === programId)).toBe(
      true,
    );
  });

  it("blocks enrollment into pending and rejected programs", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const trainee = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainee.email } });

    const pendingId = await createSubmittedProgram(trainerCookie, `Still pending ${suffix}`);
    const pendingEnroll = await request(app)
      .post(`/api/v1/trainer/programs/${pendingId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [trainee.id], batchId: "00000000-0000-4000-8000-000000000000" });
    expect(pendingEnroll.status).toBe(400);
    expect(pendingEnroll.body.error.message).toMatch(/approved/i);

    const rejectedId = await createSubmittedProgram(trainerCookie, `Rejected ${suffix}`);
    const rejected = await request(app)
      .post(`/api/v1/programs/${rejectedId}/reject`)
      .set("Cookie", adminCookie)
      .send({ reason: "Needs more curriculum" });
    expect(rejected.status).toBe(200);
    const rejectedEnroll = await request(app)
      .post(`/api/v1/trainer/programs/${rejectedId}/enrollments`)
      .set("Cookie", trainerCookie)
      .send({ traineeIds: [trainee.id], batchId: "00000000-0000-4000-8000-000000000000" });
    expect(rejectedEnroll.status).toBe(400);
  });

  it("lets an admin assign additional trainers who can then view the course and enroll", async () => {
    const superAdminCookie = await login(accounts.superAdmin.email);
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const otherTrainerCookie = await login(accounts.otherTrainer.email);

    const programId = await createSubmittedProgram(trainerCookie, `Shared ${suffix}`);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainer.email } });
    const otherTrainer = await prisma.user.findUniqueOrThrow({ where: { email: accounts.otherTrainer.email } });
    const trainee = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainee.email } });

    expect(
      (await request(app).get(`/api/v1/trainer/programs/${programId}`).set("Cookie", otherTrainerCookie)).status,
    ).toBe(403);

    const beforeList = await request(app).get("/api/v1/trainer/programs").set("Cookie", otherTrainerCookie);
    expect(beforeList.body.data.programs.some((item: { id: string }) => item.id === programId)).toBe(false);

    const adminCannotAssignAfterApproval = await request(app)
      .put(`/api/v1/admin/programs/${programId}/trainers`)
      .set("Cookie", adminCookie)
      .send({ trainerIds: [otherTrainer.id] });
    expect(adminCannotAssignAfterApproval.status).toBe(403);

    const assigned = await request(app)
      .post(`/api/v1/admin/programs/${programId}/trainers`)
      .set("Cookie", superAdminCookie)
      .send({ trainerId: otherTrainer.id });
    expect(assigned.status).toBe(201);
    const trainers = assigned.body.data.trainers as Array<{ userId: string; role: string }>;
    expect(trainers.some((row) => row.userId === owner.id && row.role === "OWNER")).toBe(true);
    expect(trainers.some((row) => row.userId === otherTrainer.id && row.role === "CO_TRAINER")).toBe(true);

    const listed = await request(app)
      .get(`/api/v1/admin/programs/${programId}/trainers`)
      .set("Cookie", adminCookie);
    expect(listed.status).toBe(200);
    const listedTrainers = listed.body.data.trainers as Array<{ userId: string; role: string }>;
    expect(listedTrainers.some((row) => row.userId === owner.id && row.role === "OWNER")).toBe(true);
    expect(listedTrainers.some((row) => row.userId === otherTrainer.id && row.role === "CO_TRAINER")).toBe(true);

    const replaced = await request(app)
      .put(`/api/v1/admin/programs/${programId}/trainers`)
      .set("Cookie", superAdminCookie)
      .send({ trainerIds: [otherTrainer.id] });
    expect(replaced.status).toBe(200);
    const replacedTrainers = replaced.body.data.program.trainers as Array<{ userId: string; role: string }>;
    expect(replacedTrainers.some((row) => row.userId === owner.id && row.role === "OWNER")).toBe(true);
    expect(replacedTrainers.some((row) => row.userId === otherTrainer.id && row.role === "CO_TRAINER")).toBe(true);

    const afterList = await request(app).get("/api/v1/trainer/programs").set("Cookie", otherTrainerCookie);
    expect(afterList.body.data.programs.some((item: { id: string }) => item.id === programId)).toBe(true);
    expect((await request(app).get(`/api/v1/trainer/programs/${programId}`).set("Cookie", otherTrainerCookie)).status).toBe(
      200,
    );

    const batchId = (
      await request(app)
        .post(`/api/v1/trainer/programs/${programId}/batches`)
        .set("Cookie", otherTrainerCookie)
        .send({ name: "Co-trainer batch", capacity: 25 })
    ).body.data.batch.id as string;

    const enrolled = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/enrollments`)
      .set("Cookie", otherTrainerCookie)
      .send({ traineeIds: [trainee.id], batchId });
    expect(enrolled.status).toBe(200);
    expect(enrolled.body.data.enrolledCount).toBe(1);

    const trainerCannotAssign = await request(app)
      .put(`/api/v1/admin/programs/${programId}/trainers`)
      .set("Cookie", trainerCookie)
      .send({ trainerIds: [otherTrainer.id] });
    expect(trainerCannotAssign.status).toBe(403);

    const invalid = await request(app)
      .put(`/api/v1/admin/programs/${programId}/trainers`)
      .set("Cookie", superAdminCookie)
      .send({ trainerIds: [trainee.id] });
    expect(invalid.status).toBe(400);
  });
});
