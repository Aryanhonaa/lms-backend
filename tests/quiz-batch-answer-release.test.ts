import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail, ensureTestBatch, mcqOptions } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-batch-reveal`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Batch Reveal Admin", email: `batch.reveal.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Batch Reveal Trainer", email: `batch.reveal.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  traineeA: { name: "Batch Reveal A", email: `batch.reveal.a.${suffix}@lms.local`, role: Role.TRAINEE },
  traineeB: { name: "Batch Reveal B", email: `batch.reveal.b.${suffix}@lms.local`, role: Role.TRAINEE },
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

function correctIds(questions: QuestionNode[]) {
  return questions.map((question) => ({
    questionId: question.id,
    optionIds: [question.options.find((option) => option.isCorrect)!.id],
  }));
}

async function completeRequiredDayItems(traineeCookie: string, programId: string) {
  const learn = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
  expect(learn.status).toBe(200);
  const requiredItems = (
    learn.body.data.weeks[0].days[0].items as Array<{ id: string; type: string; required: boolean }>
  ).filter((item) => item.required);
  for (const item of requiredItems) {
    const completed = await request(app)
      .post(`/api/v1/trainee/items/${item.type}/${item.id}/complete`)
      .set("Cookie", traineeCookie);
    expect(completed.status).toBe(200);
  }
}

describe("quiz batch answer release", () => {
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

  it("releases answers for the whole course batch with or without pending submissions", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeACookie = await login(accounts.traineeA.email);
    const traineeBCookie = await login(accounts.traineeB.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Batch Reveal Course",
        description: "Per-batch answer release",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 1,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;

    const weekRes = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    expect(weekRes.status).toBe(200);
    const weekId = weekRes.body.data.program.weeks[0].id as string;

    const dayRes = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    expect(dayRes.status).toBe(200);
    const dayId = dayRes.body.data.program.weeks[0].days[0].id as string;

    const lessonRes = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Intro", required: true });
    expect(lessonRes.status).toBe(200);

    const quizRes = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Batch practice",
        passingScore: 70,
        maxAttempts: 2,
        questions: [
          {
            prompt: "Capital of France?",
            points: 1,
            options: mcqOptions("Paris", "Lyon", "Nice", "Lille"),
          },
        ],
      });
    expect(quizRes.status).toBe(200);
    const quiz = quizRes.body.data.program.weeks[0].days[0].quizzes[0];
    const questions = quiz.questions as QuestionNode[];

    const submitted = await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    expect(submitted.status).toBe(200);
    const approved = await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    expect(approved.status).toBe(200);

    const batchId = await ensureTestBatch(app, trainerCookie, programId);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.traineeA.email, batchId);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.traineeB.email, batchId);

    await completeRequiredDayItems(traineeACookie, programId);
    await completeRequiredDayItems(traineeBCookie, programId);

    const startA = await request(app)
      .post(`/api/v1/trainee/assessments/${quiz.id}/attempts`)
      .set("Cookie", traineeACookie);
    expect(startA.status).toBe(201);
    const submitA = await request(app)
      .post(`/api/v1/trainee/attempts/${startA.body.data.attempt.id}/submit`)
      .set("Cookie", traineeACookie)
      .send({ answers: correctIds(questions) });
    expect(submitA.status).toBe(200);
    expect(submitA.body.data.attempt.answersVisible).toBe(false);

    const releasedEarly = await request(app)
      .post(`/api/v1/trainer/assessments/${quiz.id}/answer-visibility`)
      .set("Cookie", trainerCookie)
      .send({ batchId, answersVisible: true });
    expect(releasedEarly.status).toBe(200);
    expect(releasedEarly.body.data.answersVisible).toBe(true);

    const detailWaiting = await request(app)
      .get(`/api/v1/trainer/assessments/${quiz.id}?programId=${programId}&batchId=${batchId}`)
      .set("Cookie", trainerCookie);
    expect(detailWaiting.status).toBe(200);
    expect(detailWaiting.body.data.summary.canRevealAnswers).toBe(false);
    expect(detailWaiting.body.data.summary.answersVisible).toBe(true);
    expect(detailWaiting.body.data.summary.pendingSubmitCount).toBe(1);

    const hiddenBeforeNextSubmission = await request(app)
      .post(`/api/v1/trainer/assessments/${quiz.id}/answer-visibility`)
      .set("Cookie", trainerCookie)
      .send({ batchId, answersVisible: false });
    expect(hiddenBeforeNextSubmission.status).toBe(200);

    const startB = await request(app)
      .post(`/api/v1/trainee/assessments/${quiz.id}/attempts`)
      .set("Cookie", traineeBCookie);
    expect(startB.status).toBe(201);
    const submitB = await request(app)
      .post(`/api/v1/trainee/attempts/${startB.body.data.attempt.id}/submit`)
      .set("Cookie", traineeBCookie)
      .send({ answers: correctIds(questions) });
    expect(submitB.status).toBe(200);

    const detailReady = await request(app)
      .get(`/api/v1/trainer/assessments/${quiz.id}?programId=${programId}&batchId=${batchId}`)
      .set("Cookie", trainerCookie);
    expect(detailReady.status).toBe(200);
    expect(detailReady.body.data.summary.canRevealAnswers).toBe(true);
    expect(detailReady.body.data.summary.submittedCount).toBe(2);

    const released = await request(app)
      .post(`/api/v1/trainer/assessments/${quiz.id}/answer-visibility`)
      .set("Cookie", trainerCookie)
      .send({ batchId, answersVisible: true });
    expect(released.status).toBe(200);
    expect(released.body.data.answersVisible).toBe(true);

    const notificationsA = await request(app)
      .get("/api/v1/trainee/notifications")
      .set("Cookie", traineeACookie);
    expect(notificationsA.status).toBe(200);
    const answerNotification = (
      notificationsA.body.data.notifications as Array<{ title: string; href: string }>
    ).find((item) => item.title === `Answers available: ${quiz.title}`);
    expect(answerNotification?.href).toBe(`/trainee/assessments/${quiz.id}?review=answers`);

    const reviewA = await request(app)
      .get(`/api/v1/trainee/attempts/${startA.body.data.attempt.id}`)
      .set("Cookie", traineeACookie);
    expect(reviewA.status).toBe(200);
    expect(reviewA.body.data.attempt.answersVisible).toBe(true);
    expect(reviewA.body.data.attempt.questions[0].isCorrect).toBe(true);
    expect(reviewA.body.data.attempt.questions[0].correctOptionIds?.length).toBeGreaterThan(0);
    expect(reviewA.body.data.attempt.questions[0].options.length).toBeGreaterThan(0);
    expect(reviewA.body.data.attempt.questions[0].selectedOptionIds.length).toBe(1);

    const catalogA = await request(app)
      .get(`/api/v1/trainee/assessments/${quiz.id}`)
      .set("Cookie", traineeACookie);
    expect(catalogA.status).toBe(200);
    expect(catalogA.body.data.assessment.answersVisible).toBe(true);

    const hiddenAgain = await request(app)
      .post(`/api/v1/trainer/assessments/${quiz.id}/answer-visibility`)
      .set("Cookie", trainerCookie)
      .send({ batchId, answersVisible: false });
    expect(hiddenAgain.status).toBe(200);
    expect(hiddenAgain.body.data.answersVisible).toBe(false);

    const reviewHidden = await request(app)
      .get(`/api/v1/trainee/attempts/${startA.body.data.attempt.id}`)
      .set("Cookie", traineeACookie);
    expect(reviewHidden.status).toBe(200);
    expect(reviewHidden.body.data.attempt.answersVisible).toBe(false);
    expect(reviewHidden.body.data.attempt.questions[0].options).toEqual([]);
  });
});
