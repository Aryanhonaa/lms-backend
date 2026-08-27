import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-p7`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "P7 Admin", email: `phase7.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "P7 Trainer", email: `phase7.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "P7 Trainee", email: `phase7.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  other: { name: "P7 Other", email: `phase7.other.${suffix}@lms.local`, role: Role.TRAINEE },
};

type QuestionNode = {
  id: string;
  options: Array<{ id: string; isCorrect: boolean }>;
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

function oneQuestion(prompt: string) {
  return {
    prompt,
    points: 1,
    options: [
      { label: "Yes", isCorrect: true },
      { label: "No", isCorrect: false },
    ],
  };
}

function wrongIds(questions: QuestionNode[]) {
  return questions.map((question) => ({
    questionId: question.id,
    optionIds: [question.options.find((option) => !option.isCorrect)!.id],
  }));
}

async function failQuiz(cookie: string, quizId: string, questions: QuestionNode[]) {
  const started = await request(app).post(`/api/v1/trainee/assessments/${quizId}/attempts`).set("Cookie", cookie);
  expect([200, 201]).toContain(started.status);
  const submitted = await request(app)
    .post(`/api/v1/trainee/attempts/${started.body.data.attempt.id}/submit`)
    .set("Cookie", cookie)
    .send({ answers: wrongIds(questions) });
  expect(submitted.status).toBe(200);
  return submitted;
}

describe("trainer interventions and individual requirements", () => {
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

  it("flags low progress and exam scores once, assigns private requirements, and marks overdue", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);
    const otherCookie = await login(accounts.other.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Intervention Track",
        description: "Phase 7 interventions",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 1,
        trainingMode: "PROGRESSION",
        progressThreshold: 60,
        examScoreThreshold: 60,
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;
    expect(Number(created.body.data.program.progressThreshold)).toBe(60);

    const settings = await request(app)
      .patch(`/api/v1/trainer/programs/${programId}/intervention-settings`)
      .set("Cookie", trainerCookie)
      .send({ progressThreshold: 60, examScoreThreshold: 70 });
    expect(settings.status).toBe(200);
    expect(Number(settings.body.data.program.examScoreThreshold)).toBe(70);

    const weekRes = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    const weekId = weekRes.body.data.program.weeks[0].id as string;
    const dayRes = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    const dayId = dayRes.body.data.program.weeks[0].days[0].id as string;

    await request(app)
      .post(`/api/v1/trainer/days/${dayId}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Intro", required: true });

    const exam = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/weekly-exam`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Week exam",
        passingScore: 70,
        maxAttempts: 2,
        questions: [oneQuestion("Exam?")],
      });
    const weeklyExam = exam.body.data.program.weeks[0].quizzes.find((quiz: { kind: string }) => quiz.kind === "WEEKLY_EXAM");
    const examQuestions = weeklyExam.questions as QuestionNode[];

    await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const learn = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(learn.status).toBe(200);

    const firstFlags = await request(app).get("/api/v1/trainer/interventions").set("Cookie", trainerCookie);
    expect(firstFlags.status).toBe(200);
    const progressFlags = firstFlags.body.data.interventions.filter(
      (row: { trigger: string; trainee: { email: string } }) =>
        row.trigger === "PROGRESS_BELOW_THRESHOLD" && row.trainee.email === accounts.trainee.email,
    );
    expect(progressFlags).toHaveLength(1);
    expect(progressFlags[0].status).toBe("OPEN");
    const progressFlagId = progressFlags[0].id as string;
    const enrollmentId = progressFlags[0].enrollmentId as string;

    const again = await request(app).get(`/api/v1/trainee/programs/${programId}/progress`).set("Cookie", traineeCookie);
    expect(again.status).toBe(200);
    const stillOne = await request(app).get("/api/v1/trainer/interventions?status=OPEN").set("Cookie", trainerCookie);
    const stillProgress = stillOne.body.data.interventions.filter(
      (row: { trigger: string; enrollmentId: string }) =>
        row.trigger === "PROGRESS_BELOW_THRESHOLD" && row.enrollmentId === enrollmentId,
    );
    expect(stillProgress).toHaveLength(1);

    const lesson = learn.body.data.weeks[0].days[0].items.find((item: { type: string }) => item.type === "LESSON");
    const completed = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${lesson.id}/complete`)
      .set("Cookie", traineeCookie);
    expect(completed.status).toBe(200);

    await failQuiz(traineeCookie, weeklyExam.id, examQuestions);
    await failQuiz(traineeCookie, weeklyExam.id, examQuestions);

    const afterExam = await request(app).get("/api/v1/trainer/interventions").set("Cookie", trainerCookie);
    const examFlags = afterExam.body.data.interventions.filter(
      (row: { trigger: string; enrollmentId: string }) =>
        row.trigger === "EXAM_SCORE_BELOW_THRESHOLD" && row.enrollmentId === enrollmentId,
    );
    expect(examFlags).toHaveLength(1);
    expect(examFlags[0].examScore).toBe(0);
    expect(examFlags[0].status).toBe("OPEN");

    const assigned = await request(app)
      .post("/api/v1/trainer/requirements")
      .set("Cookie", trainerCookie)
      .send({
        enrollmentId,
        interventionFlagId: progressFlagId,
        type: "READING",
        title: "Catch-up reading",
        trainerMessage: "Read chapter 1 before retrying.",
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    expect(assigned.status).toBe(201);
    const requirementId = assigned.body.data.requirement.id as string;
    expect(assigned.body.data.requirement.reason).toContain("Progress");

    const overdue = await request(app)
      .post("/api/v1/trainer/requirements")
      .set("Cookie", trainerCookie)
      .send({
        enrollmentId,
        type: "CUSTOM",
        title: "Past due item",
        trainerMessage: "This was due yesterday.",
        deadline: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
    expect(overdue.status).toBe(201);
    const overdueId = overdue.body.data.requirement.id as string;

    const otherList = await request(app).get("/api/v1/trainee/requirements").set("Cookie", otherCookie);
    expect(otherList.status).toBe(200);
    expect(otherList.body.data.requirements.some((row: { id: string }) => row.id === requirementId)).toBe(false);

    const otherGet = await request(app).get(`/api/v1/trainee/requirements/${requirementId}`).set("Cookie", otherCookie);
    expect(otherGet.status).toBe(404);

    const mine = await request(app).get("/api/v1/trainee/requirements").set("Cookie", traineeCookie);
    expect(mine.status).toBe(200);
    const mineItem = mine.body.data.requirements.find((row: { id: string }) => row.id === requirementId);
    expect(mineItem.trainerMessage).toBe("Read chapter 1 before retrying.");
    expect(mineItem.status).toBe("PENDING");
    const overdueItem = mine.body.data.requirements.find((row: { id: string }) => row.id === overdueId);
    expect(overdueItem.status).toBe("OVERDUE");

    const started = await request(app)
      .post(`/api/v1/trainee/requirements/${requirementId}/start`)
      .set("Cookie", traineeCookie);
    expect(started.status).toBe(200);
    expect(started.body.data.requirement.status).toBe("IN_PROGRESS");

    const completedReq = await request(app)
      .post(`/api/v1/trainee/requirements/${requirementId}/complete`)
      .set("Cookie", traineeCookie);
    expect(completedReq.status).toBe(200);
    expect(completedReq.body.data.requirement.status).toBe("COMPLETED");
    expect(completedReq.body.data.requirement.completedAt).toBeTruthy();

    const trainerView = await request(app).get("/api/v1/trainer/requirements").set("Cookie", trainerCookie);
    expect(trainerView.body.data.requirements.some((row: { id: string; status: string }) => row.id === requirementId && row.status === "COMPLETED")).toBe(
      true,
    );

    const adminView = await request(app).get(`/api/v1/admin/requirements/${requirementId}`).set("Cookie", adminCookie);
    expect(adminView.status).toBe(200);
    expect(adminView.body.data.requirement.id).toBe(requirementId);

    const outsiderAssign = await request(app)
      .post("/api/v1/trainer/requirements")
      .set("Cookie", traineeCookie)
      .send({ enrollmentId, type: "CUSTOM", title: "Nope" });
    expect(outsiderAssign.status).toBe(403);
  });
});
