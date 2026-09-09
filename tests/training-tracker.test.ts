import { Difficulty, ProgramStatus, Role, TrainingMode } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { cookieFrom } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-nht`;
const password = "TestPass123!";
const accounts = {
  admin: { name: "NHT Admin", email: `nht.admin.${suffix}@lms.local`, role: Role.ADMIN },
  trainer: { name: "NHT Trainer", email: `nht.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "NHT Trainee", email: `nht.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  extra: { name: "NHT Extra", email: `nht.extra.${suffix}@lms.local`, role: Role.TRAINEE },
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("training and batch tracker", () => {
  let programId = "";

  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });
    const trainer = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainer.email } });
    const program = await prisma.program.create({
      data: {
        title: `NHT Course ${suffix}`,
        description: "Approved course for batch linking",
        category: "Sales",
        difficulty: Difficulty.BEGINNER,
        durationWeeks: 4,
        learningObjectives: [],
        prerequisites: [],
        trainingMode: TrainingMode.PROGRESSION,
        status: ProgramStatus.APPROVED,
        createdByUserId: trainer.id,
        trainers: { create: { userId: trainer.id, role: "OWNER" } },
      },
    });
    programId = program.id;
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.nhtLcaAudit.deleteMany({ where: { trainee: { user: { email: { in: emails } } } } });
    await prisma.nhtTniCase.deleteMany({ where: { trainee: { user: { email: { in: emails } } } } });
    await prisma.nhtAttrition.deleteMany({ where: { trainee: { user: { email: { in: emails } } } } });
    await prisma.nhtTrainee.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.nhtBatch.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.programBatch.deleteMany({ where: { programId } });
    await prisma.programTrainer.deleteMany({ where: { programId } });
    await prisma.program.deleteMany({ where: { id: programId } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("lets trainers operate batches while admins oversee and cannot create", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const trainer = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainer.email } });
    const trainee = await prisma.user.findUniqueOrThrow({ where: { email: accounts.trainee.email } });
    const extra = await prisma.user.findUniqueOrThrow({ where: { email: accounts.extra.email } });

    const adminBlocked = await request(app)
      .post("/api/v1/training-tracker/batches")
      .set("Cookie", adminCookie)
      .send({
        month: 9,
        year: 2026,
        batchNumber: 5,
        process: "VOICE_SALES",
        programId,
        trainingStartDate: "2026-08-31",
        targetCompletionDate: "2026-10-02",
        salesTrainerId: trainer.id,
      });
    expect(adminBlocked.status).toBe(403);

    const created = await request(app)
      .post("/api/v1/training-tracker/batches")
      .set("Cookie", trainerCookie)
      .send({
        month: 9,
        year: 2026,
        batchNumber: 5,
        process: "VOICE_SALES",
        programId,
        trainingStartDate: "2026-08-31",
        targetCompletionDate: "2026-10-02",
        salesTrainerId: trainer.id,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.batch.code).toBe("NHT-SEP-2026-05");
    expect(created.body.data.batch.course.id).toBe(programId);
    const batchId = created.body.data.batch.id as string;

    const joined = await request(app)
      .post(`/api/v1/training-tracker/batches/${batchId}/trainees`)
      .set("Cookie", trainerCookie)
      .send({ userId: trainee.id, joiningDate: "2026-08-31" });
    expect(joined.status).toBe(201);

    const enrollment = await prisma.enrollment.findFirst({
      where: { programId, userId: trainee.id, status: "ACTIVE" },
    });
    expect(enrollment).toBeTruthy();

    const late = await request(app)
      .post(`/api/v1/training-tracker/batches/${batchId}/trainees`)
      .set("Cookie", trainerCookie)
      .send({ userId: extra.id, joiningDate: "2026-09-01" });
    expect(late.status).toBe(201);

    const adminAuditBlocked = await request(app)
      .post("/api/v1/training-tracker/audits")
      .set("Cookie", adminCookie)
      .send({
        traineeId: joined.body.data.trainee.id,
        weekNumber: 1,
        auditDate: "2026-10-06",
        auditType: "CALL",
        score: 70,
      });
    expect(adminAuditBlocked.status).toBe(403);

    const hr = await request(app)
      .post(`/api/v1/training-tracker/trainees/${late.body.data.trainee.id}/attrition`)
      .set("Cookie", trainerCookie)
      .send({ kind: "HR", date: "2026-09-01", reason: "Did not join" });
    expect(hr.status).toBe(200);
    expect(hr.body.data.trainee.status).toBe("HR_ATTRITION");

    const dash = await request(app).get("/api/v1/training-tracker/dashboard").set("Cookie", adminCookie);
    expect(dash.status).toBe(200);
    expect(dash.body.data.kpis.hrAttrition).toBe(1);
    expect(dash.body.data.kpis.certificationPercent).toBeNull();

    const options = await request(app).get("/api/v1/training-tracker/options").set("Cookie", adminCookie);
    expect(options.status).toBe(200);
    expect(options.body.data.capabilities).toEqual({
      canOperate: false,
      canTerminate: true,
      canViewAll: true,
    });

    const trainerOptions = await request(app).get("/api/v1/training-tracker/options").set("Cookie", trainerCookie);
    expect(trainerOptions.body.data.capabilities).toEqual({
      canOperate: true,
      canTerminate: false,
      canViewAll: false,
    });

    const audit = await request(app)
      .post("/api/v1/training-tracker/audits")
      .set("Cookie", trainerCookie)
      .send({
        traineeId: joined.body.data.trainee.id,
        weekNumber: 1,
        auditDate: "2026-10-06",
        auditType: "CALL",
        score: 70,
      });
    expect(audit.status).toBe(201);
    expect(audit.body.data.trainee.status).toBe("TNI");
    expect(audit.body.data.trainee.tni.averageScore).toBe(70);
  });
});
