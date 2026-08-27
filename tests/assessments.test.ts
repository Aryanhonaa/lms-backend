import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-p5`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "P5 Admin", email: `phase5.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "P5 Trainer", email: `phase5.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "P5 Trainee", email: `phase5.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  other: { name: "P5 Other", email: `phase5.other.${suffix}@lms.local`, role: Role.TRAINEE },
};

type QuestionNode = {
  id: string;
  options: Array<{ id: string; isCorrect: boolean }>;
};

const ids = {
  programId: "",
  dayId: "",
  practiceId: "",
  weeklyId: "",
  examId: "",
  assignmentId: "",
  practiceQuestions: [] as QuestionNode[],
  weeklyQuestions: [] as QuestionNode[],
  examQuestions: [] as QuestionNode[],
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

function wrongIds(questions: QuestionNode[]) {
  return questions.map((question) => ({
    questionId: question.id,
    optionIds: [question.options.find((option) => !option.isCorrect)!.id],
  }));
}

describe("assessments and assignments", () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });

    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Assessment Track",
        description: "Phase 5 assessments",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 1,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    ids.programId = created.body.data.program.id;

    const weekRes = await request(app)
      .post(`/api/v1/trainer/programs/${ids.programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    expect(weekRes.status).toBe(200);
    const weekId = weekRes.body.data.program.weeks[0].id as string;

    const dayRes = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    expect(dayRes.status).toBe(200);
    ids.dayId = dayRes.body.data.program.weeks[0].days[0].id as string;

    const lessonRes = await request(app)
      .post(`/api/v1/trainer/days/${ids.dayId}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Intro", required: true });
    expect(lessonRes.status).toBe(200);

    const practice = await request(app)
      .post(`/api/v1/trainer/days/${ids.dayId}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Practice check",
        description: "Two questions",
        passingScore: 70,
        maxAttempts: 2,
        questions: [
          {
            prompt: "2 + 2?",
            points: 1,
            options: [
              { label: "4", isCorrect: true },
              { label: "5", isCorrect: false },
            ],
          },
          {
            prompt: "3 + 1?",
            points: 1,
            options: [
              { label: "4", isCorrect: true },
              { label: "2", isCorrect: false },
            ],
          },
        ],
      });
    expect(practice.status).toBe(200);
    const practiceQuiz = practice.body.data.program.weeks[0].days[0].quizzes[0];
    expect(practiceQuiz.kind).toBe("PRACTICE_QUIZ");
    ids.practiceId = practiceQuiz.id;
    ids.practiceQuestions = practiceQuiz.questions;

    const weekly = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/weekly-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Weekly quiz",
        maxAttempts: 1,
        passingScore: 70,
        questions: [
          {
            prompt: "Capital of France?",
            options: [
              { label: "Paris", isCorrect: true },
              { label: "Lyon", isCorrect: false },
            ],
          },
        ],
      });
    expect(weekly.status).toBe(200);
    const weeklyQuiz = weekly.body.data.program.weeks[0].quizzes[0];
    ids.weeklyId = weeklyQuiz.id;
    ids.weeklyQuestions = weeklyQuiz.questions;

    const exam = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/weekly-exam`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Timed exam",
        timeLimitMin: 1,
        passingScore: 70,
        questions: [
          {
            prompt: "1 + 1?",
            options: [
              { label: "2", isCorrect: true },
              { label: "3", isCorrect: false },
            ],
          },
        ],
      });
    expect(exam.status).toBe(200);
    const weeklyExam = exam.body.data.program.weeks[0].quizzes.find((quiz: { kind: string }) => quiz.kind === "WEEKLY_EXAM");
    ids.examId = weeklyExam.id;
    ids.examQuestions = weeklyExam.questions;

    const assignment = await request(app)
      .post(`/api/v1/trainer/days/${ids.dayId}/assignments`)
      .set("Cookie", trainerCookie)
      .send({ title: "Build a page", description: "Submit a short writeup", maxScore: 100 });
    expect(assignment.status).toBe(200);
    ids.assignmentId = assignment.body.data.program.weeks[0].days[0].assignments[0].id;

    const submitted = await request(app)
      .post(`/api/v1/programs/${ids.programId}/submit`)
      .set("Cookie", trainerCookie);
    expect(submitted.status).toBe(200);

    const approved = await request(app)
      .post(`/api/v1/programs/${ids.programId}/approve`)
      .set("Cookie", adminCookie);
    expect(approved.status).toBe(200);
    await enrollTraineeByEmail(app, trainerCookie, ids.programId, accounts.trainee.email);
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("creates assessments without exposing keys on start, grades on the server, and enforces attempts", async () => {
    const traineeCookie = await login(accounts.trainee.email);
    const otherCookie = await login(accounts.other.email);
    const trainerCookie = await login(accounts.trainer.email);

    const learn = await request(app)
      .get(`/api/v1/trainee/programs/${ids.programId}/learn`)
      .set("Cookie", traineeCookie);
    expect(learn.status).toBe(200);
    const requiredItems = (learn.body.data.weeks[0].days[0].items as Array<{ id: string; type: string; required: boolean }>).filter(
      (item) => item.required,
    );
    for (const item of requiredItems) {
      const completed = await request(app)
        .post(`/api/v1/trainee/items/${item.type}/${item.id}/complete`)
        .set("Cookie", traineeCookie);
      expect(completed.status).toBe(200);
    }

    const created = await request(app)
      .post(`/api/v1/trainee/assessments/${ids.practiceId}/attempts`)
      .set("Cookie", traineeCookie);
    expect(created.status).toBe(201);
    const started = created.body.data.attempt;
    expect(JSON.stringify(created.body)).not.toContain("isCorrect");
    expect(JSON.stringify(created.body)).not.toContain("correctOptionIds");
    expect(started.questions[0].options[0].isCorrect).toBeUndefined();
    expect(started.score).toBeNull();
    expect(started.passed).toBeNull();

    const fetchedOpen = await request(app)
      .get(`/api/v1/trainee/attempts/${started.id}`)
      .set("Cookie", traineeCookie);
    expect(fetchedOpen.status).toBe(200);
    expect(JSON.stringify(fetchedOpen.body)).not.toContain("isCorrect");
    expect(fetchedOpen.body.data.attempt.score).toBeNull();

    const resumed = await request(app)
      .post(`/api/v1/trainee/assessments/${ids.practiceId}/attempts`)
      .set("Cookie", traineeCookie);
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.attempt.id).toBe(started.id);

    const failed = await request(app)
      .post(`/api/v1/trainee/attempts/${started.id}/submit`)
      .set("Cookie", traineeCookie)
      .send({ answers: wrongIds(ids.practiceQuestions), score: 100, passed: true, correct: true });
    expect(failed.status).toBe(200);
    expect(failed.body.data.attempt.passed).toBe(false);
    expect(failed.body.data.attempt.score).toBe(0);
    expect(failed.body.data.attempt.status).toBe("SUBMITTED");

    const second = await request(app)
      .post(`/api/v1/trainee/assessments/${ids.practiceId}/attempts`)
      .set("Cookie", traineeCookie);
    expect(second.status).toBe(201);

    const passed = await request(app)
      .post(`/api/v1/trainee/attempts/${second.body.data.attempt.id}/submit`)
      .set("Cookie", traineeCookie)
      .send({ answers: correctIds(ids.practiceQuestions) });
    expect(passed.status).toBe(200);
    expect(passed.body.data.attempt.passed).toBe(true);
    expect(passed.body.data.attempt.score).toBe(100);

    const catalog = await request(app).get(`/api/v1/trainee/assessments/${ids.practiceId}`).set("Cookie", traineeCookie);
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.passed).toBe(true);
    expect(catalog.body.data.attemptsUsed).toBe(2);
    expect(catalog.body.data.canStart).toBe(false);

    const weeklyStart = await request(app)
      .post(`/api/v1/trainee/assessments/${ids.weeklyId}/attempts`)
      .set("Cookie", traineeCookie);
    expect(weeklyStart.status).toBe(201);
    const weeklyFail = await request(app)
      .post(`/api/v1/trainee/attempts/${weeklyStart.body.data.attempt.id}/submit`)
      .set("Cookie", traineeCookie)
      .send({ answers: wrongIds(ids.weeklyQuestions) });
    expect(weeklyFail.status).toBe(200);
    expect(weeklyFail.body.data.attempt.passed).toBe(false);

    const maxed = await request(app)
      .post(`/api/v1/trainee/assessments/${ids.weeklyId}/attempts`)
      .set("Cookie", traineeCookie);
    expect(maxed.status).toBe(403);
    expect(maxed.body.error.code).toBe("MAX_ATTEMPTS");

    const outsider = await request(app)
      .post(`/api/v1/trainee/attempts/${second.body.data.attempt.id}/submit`)
      .set("Cookie", otherCookie)
      .send({ answers: correctIds(ids.practiceQuestions) });
    expect(outsider.status).toBe(404);

    const trainerForbidden = await request(app)
      .post(`/api/v1/trainee/assessments/${ids.practiceId}/attempts`)
      .set("Cookie", trainerCookie);
    expect(trainerForbidden.status).toBe(403);

    const timed = await request(app)
      .post(`/api/v1/trainee/assessments/${ids.examId}/attempts`)
      .set("Cookie", traineeCookie);
    expect(timed.status).toBe(201);
    await prisma.assessmentAttempt.update({
      where: { id: timed.body.data.attempt.id },
      data: { deadlineAt: new Date(Date.now() - 10_000) },
    });
    const timedOut = await request(app)
      .post(`/api/v1/trainee/attempts/${timed.body.data.attempt.id}/submit`)
      .set("Cookie", traineeCookie)
      .send({ answers: correctIds(ids.examQuestions) });
    expect(timedOut.status).toBe(200);
    expect(timedOut.body.data.attempt.status).toBe("TIMED_OUT");
    expect(timedOut.body.data.attempt.score).toBe(0);
    expect(timedOut.body.data.attempt.passed).toBe(false);
  });

  it("lets a trainee submit an assignment and a trainer grade or request changes", async () => {
    const traineeCookie = await login(accounts.trainee.email);
    const trainerCookie = await login(accounts.trainer.email);

    const submitted = await request(app)
      .post(`/api/v1/trainee/assignments/${ids.assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "First draft of the page", submit: true });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.submission.status).toBe("SUBMITTED");
    const submissionId = submitted.body.data.submission.id as string;

    const blocked = await request(app)
      .post(`/api/v1/trainee/assignments/${ids.assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "Should not overwrite", submit: true });
    expect(blocked.status).toBe(409);

    const changes = await request(app)
      .post(`/api/v1/trainer/submissions/${submissionId}/review`)
      .set("Cookie", trainerCookie)
      .send({ status: "CHANGES_REQUESTED", comment: "Add a heading" });
    expect(changes.status).toBe(200);
    expect(changes.body.data.submission.status).toBe("CHANGES_REQUESTED");

    const resubmit = await request(app)
      .post(`/api/v1/trainee/assignments/${ids.assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "Updated with a heading", submit: true });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.submission.status).toBe("SUBMITTED");
    expect(resubmit.body.data.submission.revision).toBe(2);
    expect(resubmit.body.data.submission.id).not.toBe(submissionId);

    const original = await request(app)
      .get(`/api/v1/trainer/assignments/${ids.assignmentId}`)
      .set("Cookie", trainerCookie);
    expect(original.status).toBe(200);
    expect(original.body.data.submissions.some((row: { id: string; revision: number }) => row.id === submissionId && row.revision === 1)).toBe(
      true,
    );

    const graded = await request(app)
      .post(`/api/v1/trainer/submissions/${resubmit.body.data.submission.id}/review`)
      .set("Cookie", trainerCookie)
      .send({ status: "GRADED", score: 90, comment: "Good" });
    expect(graded.status).toBe(200);
    expect(graded.body.data.submission.status).toBe("GRADED");
    expect(graded.body.data.submission.score).toBe(90);
  });
});
