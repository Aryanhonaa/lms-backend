import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { cookieFrom, enrollTraineeByEmail, ensureTestBatch, mcqOptions } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-scope`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Scope Admin", email: `scope.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Scope Trainer", email: `scope.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  otherTrainer: { name: "Scope Other Trainer", email: `scope.othertrainer.${suffix}@lms.local`, role: Role.TRAINER },
  aryan: { name: "Aryan", email: `scope.aryan.${suffix}@lms.local`, role: Role.TRAINEE },
  sarah: { name: "Sarah", email: `scope.sarah.${suffix}@lms.local`, role: Role.TRAINEE },
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("trainer assessment and assignment batch scope", () => {
  let programId = "";
  let otherProgramId = "";
  let assignmentId = "";
  let quizId = "";
  let septemberId = "";
  let octoberId = "";
  let otherBatchId = "";

  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });
    const trainerCookie = await login(accounts.trainer.email);
    const otherTrainerCookie = await login(accounts.otherTrainer.email);
    const adminCookie = await login(accounts.admin.email);

    const created = await request(app).post("/api/v1/trainer/programs").set("Cookie", trainerCookie).send({
      title: `Scope Program ${suffix}`,
      description: "Course and batch filters",
      category: "Web",
      difficulty: "BEGINNER",
      durationWeeks: 1,
      trainingMode: "PROGRESSION",
    });
    expect(created.status).toBe(201);
    programId = created.body.data.program.id as string;

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
    expect(
      (
        await request(app)
          .post(`/api/v1/trainer/days/${dayId}/lessons`)
          .set("Cookie", trainerCookie)
          .send({ title: "Intro", required: true })
      ).status,
    ).toBe(200);

    const assignment = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/assignments`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Batch scoped assignment",
        description: "Write a short answer",
        maxScore: 100,
        allowTextResponse: true,
        allowLateSubmission: true,
      });
    expect(assignment.status).toBe(200);
    assignmentId = assignment.body.data.program.weeks[0].days[0].assignments[0].id as string;

    const quiz = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Batch scoped quiz",
        passingScore: 70,
        maxAttempts: 2,
        questions: [
          {
            prompt: "2 + 2?",
            points: 1,
            options: mcqOptions("4", "5", "6", "7"),
          },
        ],
      });
    expect(quiz.status).toBe(200);
    const quizNode = quiz.body.data.program.weeks[0].days[0].quizzes[0] as {
      id: string;
      questions: Array<{ id: string; options: Array<{ id: string; isCorrect: boolean }> }>;
    };
    quizId = quizNode.id;
    const quizAnswers = quizNode.questions.map((question) => ({
      questionId: question.id,
      optionIds: [question.options.find((option) => option.isCorrect)!.id],
    }));

    expect((await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie)).status).toBe(200);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);

    const other = await request(app).post("/api/v1/trainer/programs").set("Cookie", otherTrainerCookie).send({
      title: `Other Scope Program ${suffix}`,
      description: "Not this trainer",
      category: "Web",
      difficulty: "BEGINNER",
      durationWeeks: 1,
      trainingMode: "PROGRESSION",
    });
    expect(other.status).toBe(201);
    otherProgramId = other.body.data.program.id as string;
    expect((await request(app).post(`/api/v1/trainer/programs/${otherProgramId}/weeks`).set("Cookie", otherTrainerCookie).send({ title: "Week 1" })).status).toBe(200);
    expect((await request(app).post(`/api/v1/programs/${otherProgramId}/submit`).set("Cookie", otherTrainerCookie)).status).toBe(200);
    expect((await request(app).post(`/api/v1/programs/${otherProgramId}/approve`).set("Cookie", adminCookie)).status).toBe(200);
    otherBatchId = await ensureTestBatch(app, otherTrainerCookie, otherProgramId, "Other batch");

    septemberId = await ensureTestBatch(app, trainerCookie, programId, "September 2026");
    octoberId = await ensureTestBatch(app, trainerCookie, programId, "October 2026");
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.aryan.email, septemberId);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.aryan.email, octoberId);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.sarah.email, octoberId);

    const aryanCookie = await login(accounts.aryan.email);
    const sarahCookie = await login(accounts.sarah.email);

    async function completeRequired(cookie: string, batchId: string) {
      const learn = await request(app)
        .get(`/api/v1/trainee/programs/${programId}/learn?batchId=${batchId}`)
        .set("Cookie", cookie);
      expect(learn.status).toBe(200);
      const requiredItems = (
        learn.body.data.weeks[0].days[0].items as Array<{ id: string; type: string; required: boolean }>
      ).filter((item) => item.required);
      for (const item of requiredItems) {
        expect(
          (
            await request(app)
              .post(`/api/v1/trainee/items/${item.type}/${item.id}/complete?batchId=${batchId}`)
              .set("Cookie", cookie)
          ).status,
        ).toBe(200);
      }
    }

    await completeRequired(aryanCookie, octoberId);
    await completeRequired(sarahCookie, octoberId);

    async function passQuiz(cookie: string) {
      const started = await request(app).post(`/api/v1/trainee/assessments/${quizId}/attempts`).set("Cookie", cookie);
      expect(started.status).toBe(201);
      const submittedQuiz = await request(app)
        .post(`/api/v1/trainee/attempts/${started.body.data.attempt.id}/submit`)
        .set("Cookie", cookie)
        .send({ answers: quizAnswers });
      expect(submittedQuiz.status).toBe(200);
    }

    await passQuiz(aryanCookie);
    await passQuiz(sarahCookie);

    const submitted = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", aryanCookie)
      .send({ body: "October submission", submit: true });
    expect(submitted.status).toBe(200);

    const sarahSubmitted = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", sarahCookie)
      .send({ body: "Sarah October", submit: true });
    expect(sarahSubmitted.status).toBe(200);
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("keeps September and October assignment work on separate roster rows", async () => {
    const trainerCookie = await login(accounts.trainer.email);

    const unscoped = await request(app).get(`/api/v1/trainer/assignments/${assignmentId}`).set("Cookie", trainerCookie);
    expect(unscoped.status).toBe(200);
    const unscopedRoster = unscoped.body.data.roster as Array<{
      enrollmentId: string;
      traineeId: string;
      status: string;
      batch: { id: string; name: string };
    }>;
    const aryan = await prisma.user.findUniqueOrThrow({ where: { email: accounts.aryan.email } });
    const aryanRows = unscopedRoster.filter((row) => row.traineeId === aryan.id);
    expect(aryanRows).toHaveLength(2);
    expect(new Set(aryanRows.map((row) => row.enrollmentId)).size).toBe(2);
    expect(unscopedRoster.some((row) => row.batch.id === septemberId && row.status === "NOT_STARTED")).toBe(true);
    expect(unscopedRoster.some((row) => row.batch.id === octoberId && row.status === "SUBMITTED")).toBe(true);

    const september = await request(app)
      .get(`/api/v1/trainer/assignments/${assignmentId}?programId=${programId}&batchId=${septemberId}`)
      .set("Cookie", trainerCookie);
    expect(september.status).toBe(200);
    const septemberRoster = september.body.data.roster as Array<{ status: string; batch: { id: string }; trainee: { email: string } }>;
    expect(septemberRoster).toHaveLength(1);
    expect(septemberRoster[0].batch.id).toBe(septemberId);
    expect(septemberRoster[0].status).toBe("NOT_STARTED");
    expect(septemberRoster[0].trainee.email).toBe(accounts.aryan.email);

    const october = await request(app)
      .get(`/api/v1/trainer/assignments/${assignmentId}?programId=${programId}&batchId=${octoberId}`)
      .set("Cookie", trainerCookie);
    expect(october.status).toBe(200);
    const octoberRoster = october.body.data.roster as Array<{ status: string; batch: { id: string }; trainee: { email: string } }>;
    expect(octoberRoster).toHaveLength(2);
    expect(octoberRoster.every((row) => row.batch.id === octoberId)).toBe(true);
    expect(octoberRoster.filter((row) => row.status === "SUBMITTED")).toHaveLength(2);

    const listed = await request(app)
      .get(`/api/v1/trainer/assignments?programId=${programId}&batchId=${septemberId}`)
      .set("Cookie", trainerCookie);
    expect(listed.status).toBe(200);
    const septemberSummary = listed.body.data.assignments.find((row: { id: string }) => row.id === assignmentId);
    expect(septemberSummary.submissionCount).toBe(0);
    expect(septemberSummary.programTitle).toContain("Scope Program");

    const octoberListed = await request(app)
      .get(`/api/v1/trainer/assignments?programId=${programId}&batchId=${octoberId}`)
      .set("Cookie", trainerCookie);
    const octoberSummary = octoberListed.body.data.assignments.find((row: { id: string }) => row.id === assignmentId);
    expect(octoberSummary.submissionCount).toBe(2);
    expect(octoberSummary.pendingReview).toBe(2);
  });

  it("scopes quiz attempts and counts to the selected batch", async () => {
    const trainerCookie = await login(accounts.trainer.email);

    const september = await request(app)
      .get(`/api/v1/trainer/assessments/${quizId}?programId=${programId}&batchId=${septemberId}`)
      .set("Cookie", trainerCookie);
    expect(september.status).toBe(200);
    expect(september.body.data.attempts).toHaveLength(0);
    expect(september.body.data.assessment.programId).toBe(programId);

    const october = await request(app)
      .get(`/api/v1/trainer/assessments/${quizId}?programId=${programId}&batchId=${octoberId}`)
      .set("Cookie", trainerCookie);
    expect(october.status).toBe(200);
    expect(october.body.data.attempts).toHaveLength(2);
    expect(october.body.data.attempts.every((row: { batch: { id: string } }) => row.batch.id === octoberId)).toBe(true);
    expect(october.body.data.attempts.some((row: { trainee: { email: string } }) => row.trainee.email === accounts.aryan.email)).toBe(true);

    const septemberList = await request(app)
      .get(`/api/v1/trainer/assessments?programId=${programId}&batchId=${septemberId}`)
      .set("Cookie", trainerCookie);
    expect(septemberList.body.data.assessments.find((row: { id: string }) => row.id === quizId).attemptCount).toBe(0);

    const octoberList = await request(app)
      .get(`/api/v1/trainer/assessments?programId=${programId}&batchId=${octoberId}`)
      .set("Cookie", trainerCookie);
    expect(octoberList.body.data.assessments.find((row: { id: string }) => row.id === quizId).attemptCount).toBe(2);
  });

  it("rejects another trainer's batch and a mismatched course", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const foreign = await request(app)
      .get(`/api/v1/trainer/assignments/${assignmentId}?batchId=${otherBatchId}`)
      .set("Cookie", trainerCookie);
    expect(foreign.status).toBe(403);

    const mismatch = await request(app)
      .get(`/api/v1/trainer/assignments/${assignmentId}?programId=${otherProgramId}&batchId=${octoberId}`)
      .set("Cookie", trainerCookie);
    expect([400, 403]).toContain(mismatch.status);
  });
});
