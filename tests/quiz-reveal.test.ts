import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail, mcqOptions } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-reveal`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Reveal Admin", email: `reveal.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Reveal Trainer", email: `reveal.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "Reveal Trainee", email: `reveal.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
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

function oneQuestion() {
  return [
    {
      prompt: "2 + 2?",
      points: 1,
      options: mcqOptions("4", "5", "6", "7"),
    },
  ];
}

function correctIds(questions: QuestionNode[]) {
  return questions.map((question) => ({
    questionId: question.id,
    optionIds: [question.options.find((option) => option.isCorrect)!.id],
  }));
}

describe("quiz answer reveal", () => {
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

  it("hides the paper from trainees, keeps trainer review, and does not announce a scheduled reveal", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Reveal Track",
        description: "Answer visibility",
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

    const hidden = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Hidden practice",
        passingScore: 70,
        maxAttempts: 2,
        revealMode: "HIDDEN",
        questions: oneQuestion(),
      });
    expect(hidden.status).toBe(200);
    const hiddenQuiz = hidden.body.data.program.weeks[0].days[0].quizzes[0];
    const hiddenQuestions = hiddenQuiz.questions as QuestionNode[];

    const pastReveal = new Date(Date.now() - 60_000).toISOString();
    const scheduledPast = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/weekly-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Past reveal quiz",
        passingScore: 70,
        maxAttempts: 1,
        revealMode: "SCHEDULED",
        revealAt: pastReveal,
        questions: oneQuestion(),
      });
    expect(scheduledPast.status).toBe(200);
    const pastQuiz = scheduledPast.body.data.program.weeks[0].quizzes.find(
      (quiz: { kind: string }) => quiz.kind === "WEEKLY_QUIZ",
    );
    const pastQuestions = pastQuiz.questions as QuestionNode[];

    const futureReveal = new Date(Date.now() + 86_400_000).toISOString();
    const scheduledFuture = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/weekly-exam`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Future reveal exam",
        passingScore: 70,
        maxAttempts: 1,
        revealMode: "SCHEDULED",
        revealAt: futureReveal,
        questions: oneQuestion(),
      });
    expect(scheduledFuture.status).toBe(200);
    const futureQuiz = scheduledFuture.body.data.program.weeks[0].quizzes.find(
      (quiz: { kind: string }) => quiz.kind === "WEEKLY_EXAM",
    );
    const futureQuestions = futureQuiz.questions as QuestionNode[];

    const submitted = await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    expect(submitted.status).toBe(200);
    const approved = await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    expect(approved.status).toBe(200);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const trainerEmpty = await request(app)
      .get(`/api/v1/trainer/assessments/${hiddenQuiz.id}`)
      .set("Cookie", trainerCookie);
    expect(trainerEmpty.status).toBe(200);
    expect(trainerEmpty.body.data.roster).toHaveLength(1);
    expect(trainerEmpty.body.data.roster[0].status).toBe("NOT_STARTED");
    expect(trainerEmpty.body.data.summary.notStartedCount).toBe(1);
    expect(trainerEmpty.body.data.assessment.questions[0].options[0].isCorrect).toBe(true);

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

    const hiddenStart = await request(app)
      .post(`/api/v1/trainee/assessments/${hiddenQuiz.id}/attempts`)
      .set("Cookie", traineeCookie);
    expect(hiddenStart.status).toBe(201);
    const hiddenSubmit = await request(app)
      .post(`/api/v1/trainee/attempts/${hiddenStart.body.data.attempt.id}/submit`)
      .set("Cookie", traineeCookie)
      .send({ answers: correctIds(hiddenQuestions) });
    expect(hiddenSubmit.status).toBe(200);
    expect(hiddenSubmit.body.data.attempt.passed).toBe(true);
    expect(hiddenSubmit.body.data.attempt.score).toBe(100);
    expect(hiddenSubmit.body.data.attempt.answersVisible).toBe(false);
    expect(JSON.stringify(hiddenSubmit.body)).not.toContain("correctOptionIds");
    expect(hiddenSubmit.body.data.attempt.questions[0].isCorrect).toBeUndefined();
    expect(hiddenSubmit.body.data.attempt.questions[0].options).toEqual([]);
    expect(hiddenSubmit.body.data.attempt.questions[0].selectedOptionIds).toEqual([]);

    const pastStart = await request(app)
      .post(`/api/v1/trainee/assessments/${pastQuiz.id}/attempts`)
      .set("Cookie", traineeCookie);
    expect(pastStart.status).toBe(201);
    const pastSubmit = await request(app)
      .post(`/api/v1/trainee/attempts/${pastStart.body.data.attempt.id}/submit`)
      .set("Cookie", traineeCookie)
      .send({ answers: correctIds(pastQuestions) });
    expect(pastSubmit.status).toBe(200);
    expect(pastSubmit.body.data.attempt.answersVisible).toBe(false);
    expect(pastSubmit.body.data.attempt.questions[0].isCorrect).toBeUndefined();
    expect(pastSubmit.body.data.attempt.questions[0].correctOptionIds).toBeUndefined();
    expect(pastSubmit.body.data.attempt.questions[0].options).toEqual([]);

    const listedOnce = await request(app).get("/api/v1/trainee/announcements").set("Cookie", traineeCookie);
    expect(listedOnce.status).toBe(200);
    const revealNotes = (
      listedOnce.body.data.announcements as Array<{ title: string; audience: string; program: { id: string } | null }>
    ).filter((row) => row.title.includes("Past reveal quiz") && row.audience === "PROGRAM");
    expect(revealNotes).toHaveLength(0);

    const catalogAgain = await request(app)
      .get(`/api/v1/trainee/assessments/${pastQuiz.id}`)
      .set("Cookie", traineeCookie);
    expect(catalogAgain.status).toBe(200);
    const listedTwice = await request(app).get("/api/v1/trainee/announcements").set("Cookie", traineeCookie);
    const revealNotesAgain = (
      listedTwice.body.data.announcements as Array<{ title: string }>
    ).filter((row) => row.title.includes("Past reveal quiz"));
    expect(revealNotesAgain).toHaveLength(0);

    const futureStart = await request(app)
      .post(`/api/v1/trainee/assessments/${futureQuiz.id}/attempts`)
      .set("Cookie", traineeCookie);
    expect(futureStart.status).toBe(201);
    const futureSubmit = await request(app)
      .post(`/api/v1/trainee/attempts/${futureStart.body.data.attempt.id}/submit`)
      .set("Cookie", traineeCookie)
      .send({ answers: correctIds(futureQuestions) });
    expect(futureSubmit.status).toBe(200);
    expect(futureSubmit.body.data.attempt.passed).toBe(true);
    expect(futureSubmit.body.data.attempt.answersVisible).toBe(false);
    expect(futureSubmit.body.data.attempt.questions[0].isCorrect).toBeUndefined();
    expect(futureSubmit.body.data.attempt.questions[0].options).toEqual([]);

    const trainerPaper = await request(app)
      .get(`/api/v1/trainer/assessments/${hiddenQuiz.id}`)
      .set("Cookie", trainerCookie);
    expect(trainerPaper.status).toBe(200);
    expect(trainerPaper.body.data.roster[0].status).toBe("SUBMITTED");
    expect(trainerPaper.body.data.roster[0].latest.answers[0].isCorrect).toBe(true);
    expect(trainerPaper.body.data.summary.submittedCount).toBe(1);
    expect(trainerPaper.body.data.summary.averageScore).toBe(100);
    expect(trainerPaper.body.data.summary.passRate).toBe(100);
  });
});
