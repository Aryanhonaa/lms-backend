import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";

const app = createApp();
const suffix = `${Date.now()}-p3`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "P3 Admin", email: `phase3.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  manager: { name: "P3 Manager", email: `phase3.manager.${suffix}@lms.local`, role: Role.ADMIN },
  trainer: { name: "P3 Trainer", email: `phase3.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  otherTrainer: { name: "P3 Other", email: `phase3.other.${suffix}@lms.local`, role: Role.TRAINER },
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

describe("program authoring and approval", () => {
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

  it("lets a trainer create, save, edit, and submit, then an admin reject or approve", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Full Stack Foundations",
        description: "Relational curriculum authoring",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 4,
        trainingMode: "PROGRESSION",
      });

    expect(created.status).toBe(201);
    expect(created.body.data.program.status).toBe("DRAFT");
    const programId = created.body.data.program.id as string;

    const otherTrainerCookie = await login(accounts.otherTrainer.email);
    const managerCookie = await login(accounts.manager.email);

    const trainerDraftList = await request(app).get("/api/v1/trainer/programs").set("Cookie", trainerCookie);
    expect(trainerDraftList.body.data.programs.some((item: { id: string }) => item.id === programId)).toBe(true);

    const otherTrainerDraftList = await request(app).get("/api/v1/trainer/programs").set("Cookie", otherTrainerCookie);
    expect(otherTrainerDraftList.body.data.programs.some((item: { id: string }) => item.id === programId)).toBe(false);

    const otherTrainerDraftGet = await request(app)
      .get(`/api/v1/trainer/programs/${programId}`)
      .set("Cookie", otherTrainerCookie);
    expect(otherTrainerDraftGet.status).toBe(404);

    for (const cookie of [adminCookie, managerCookie]) {
      const catalogWhileDraft = await request(app).get("/api/v1/admin/programs?view=all").set("Cookie", cookie);
      expect(catalogWhileDraft.status).toBe(200);
      expect(catalogWhileDraft.body.data.programs.some((item: { id: string }) => item.id === programId)).toBe(false);

      const draftByReviewer = await request(app).get(`/api/v1/admin/programs/${programId}`).set("Cookie", cookie);
      expect(draftByReviewer.status).toBe(404);

      const draftFilter = await request(app).get("/api/v1/admin/programs?status=DRAFT").set("Cookie", cookie);
      expect(draftFilter.status).toBe(400);
    }

    const tooSoon = await request(app)
      .post(`/api/v1/programs/${programId}/submit`)
      .set("Cookie", trainerCookie);
    expect(tooSoon.status).toBe(400);

    const edited = await request(app)
      .patch(`/api/v1/trainer/programs/${programId}`)
      .set("Cookie", trainerCookie)
      .send({ title: "Full Stack Foundations v2" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.program.title).toBe("Full Stack Foundations v2");

    const week = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    expect(week.status).toBe(200);
    const weekId = week.body.data.program.weeks[0].id as string;

    const day = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    expect(day.status).toBe(200);
    const dayId = day.body.data.program.weeks[0].days[0].id as string;

    const lesson = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "HTML basics", durationMin: 30 });
    expect(lesson.status).toBe(200);
    expect(lesson.body.data.program.weeks[0].days[0].lessons[0].title).toBe("HTML basics");

    const submitted = await request(app)
      .post(`/api/v1/programs/${programId}/submit`)
      .set("Cookie", trainerCookie);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.program.status).toBe("SUBMITTED");

    const pendingCatalog = await request(app).get("/api/v1/admin/programs?view=all").set("Cookie", adminCookie);
    expect(pendingCatalog.body.data.programs.some((item: { id: string }) => item.id === programId)).toBe(true);
    const pendingByAdmin = await request(app).get(`/api/v1/admin/programs/${programId}`).set("Cookie", adminCookie);
    expect(pendingByAdmin.status).toBe(200);
    const pendingByManager = await request(app).get(`/api/v1/admin/programs/${programId}`).set("Cookie", managerCookie);
    expect(pendingByManager.status).toBe(200);

    const forbiddenSubmit = await request(app)
      .post(`/api/v1/programs/${programId}/submit`)
      .set("Cookie", otherTrainerCookie);
    expect(forbiddenSubmit.status).toBe(403);

    const trainerApprove = await request(app)
      .post(`/api/v1/programs/${programId}/approve`)
      .set("Cookie", trainerCookie);
    expect(trainerApprove.status).toBe(403);

    const queue = await request(app)
      .get("/api/v1/admin/programs?status=SUBMITTED")
      .set("Cookie", adminCookie);
    expect(queue.status).toBe(200);
    expect(queue.body.data.programs.some((item: { id: string }) => item.id === programId)).toBe(true);

    const rejected = await request(app)
      .post(`/api/v1/programs/${programId}/reject`)
      .set("Cookie", adminCookie)
      .send({ reason: "Add a practice quiz" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.program.status).toBe("REJECTED");
    expect(rejected.body.data.program.rejectionReason).toBe("Add a practice quiz");
    expect(rejected.body.data.program.rejectedByUserId).toBeTruthy();
    expect(rejected.body.data.program.rejectedAt).toBeTruthy();

    const afterRejectEdit = await request(app)
      .patch(`/api/v1/trainer/programs/${programId}`)
      .set("Cookie", trainerCookie)
      .send({ description: "Updated after rejection" });
    expect(afterRejectEdit.status).toBe(200);
    expect(afterRejectEdit.body.data.program.status).toBe("REJECTED");

    const quiz = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "HTML check",
        questions: [
          {
            prompt: "HTML stands for?",
            options: [
              { label: "HyperText Markup Language", isCorrect: true },
              { label: "Hot Mail", isCorrect: false },
            ],
          },
        ],
      });
    expect(quiz.status).toBe(200);

    const resubmit = await request(app)
      .post(`/api/v1/programs/${programId}/submit`)
      .set("Cookie", trainerCookie);
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.program.status).toBe("SUBMITTED");

    const approved = await request(app)
      .post(`/api/v1/programs/${programId}/approve`)
      .set("Cookie", adminCookie);
    expect(approved.status).toBe(200);
    expect(approved.body.data.program.status).toBe("APPROVED");
    expect(approved.body.data.program.rejectionReason).toBeNull();
  });

  it("lets a trainer delete a draft and an admin delete an approved course without enrollments", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const otherTrainerCookie = await login(accounts.otherTrainer.email);
    const adminCookie = await login(accounts.admin.email);
    const managerCookie = await login(accounts.manager.email);

    const draft = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Disposable Draft",
        description: "Should be deletable",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 1,
        trainingMode: "PROGRESSION",
      });
    expect(draft.status).toBe(201);
    const draftId = draft.body.data.program.id as string;

    const foreignDelete = await request(app).delete(`/api/v1/trainer/programs/${draftId}`).set("Cookie", otherTrainerCookie);
    expect(foreignDelete.status).toBe(403);

    const adminDraftDelete = await request(app).delete(`/api/v1/admin/programs/${draftId}`).set("Cookie", adminCookie);
    expect(adminDraftDelete.status).toBe(404);

    const trainerDelete = await request(app).delete(`/api/v1/trainer/programs/${draftId}`).set("Cookie", trainerCookie);
    expect(trainerDelete.status).toBe(200);
    expect(trainerDelete.body.data.deleted).toBe(true);
    expect(await prisma.program.findUnique({ where: { id: draftId } })).toBeNull();

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Disposable Approved",
        description: "Approved then deleted by admin",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 1,
        trainingMode: "PROGRESSION",
      });
    const programId = created.body.data.program.id as string;
    const week = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    expect(week.status).toBe(200);

    const submitted = await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    expect(submitted.status).toBe(200);

    const trainerApprovedDelete = await request(app)
      .delete(`/api/v1/trainer/programs/${programId}`)
      .set("Cookie", trainerCookie);
    expect(trainerApprovedDelete.status).toBe(400);

    const approved = await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", managerCookie);
    expect(approved.status).toBe(200);

    const removed = await request(app).delete(`/api/v1/admin/programs/${programId}`).set("Cookie", managerCookie);
    expect(removed.status).toBe(200);
    expect(removed.body.data.deleted).toBe(true);
    expect(await prisma.program.findUnique({ where: { id: programId } })).toBeNull();
  });
});
