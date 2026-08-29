import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail, mcqOptions } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-exhausted`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Gate Admin", email: `gate.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Gate Trainer", email: `gate.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "Gate Trainee", email: `gate.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
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
  return {
    prompt: "2 + 2?",
    points: 1,
    options: mcqOptions("4", "5", "6", "7"),
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
  expect(submitted.body.data.attempt.passed).toBe(false);
  return submitted;
}

describe("exhausted quiz attempts unlock the next step", () => {
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

  it("unlocks week 2 after a 1/1 fail, without passing or awarding quiz credit", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Exhausted Gate Track",
        description: "Fail once then continue",
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
    const week1Id = week1Res.body.data.program.weeks[0].id as string;
    const week2Res = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 2" });
    const week2Id = week2Res.body.data.program.weeks.find((week: { title: string }) => week.title === "Week 2").id as string;

    const day1Id = (
      await request(app).post(`/api/v1/trainer/weeks/${week1Id}/days`).set("Cookie", trainerCookie).send({ title: "Day 1" })
    ).body.data.program.weeks.find((week: { id: string }) => week.id === week1Id).days[0].id as string;
    const day2Id = (
      await request(app).post(`/api/v1/trainer/weeks/${week2Id}/days`).set("Cookie", trainerCookie).send({ title: "Day 1" })
    ).body.data.program.weeks.find((week: { id: string }) => week.id === week2Id).days[0].id as string;

    await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Lesson 1", required: true });
    await request(app)
      .post(`/api/v1/trainer/days/${day2Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "dsa", required: true });

    const practice = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({ title: "Gate quiz", passingScore: 70, maxAttempts: 1, questions: [oneQuestion()] });
    const practiceQuiz = practice.body.data.program.weeks[0].days[0].quizzes[0];
    const practiceQuestions = practiceQuiz.questions as QuestionNode[];

    await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const learn = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    const lesson = learn.body.data.weeks[0].days[0].items.find((item: { type: string }) => item.type === "LESSON");
    expect(
      (await request(app).post(`/api/v1/trainee/items/LESSON/${lesson.id}/complete`).set("Cookie", traineeCookie)).status,
    ).toBe(200);

    await failQuiz(traineeCookie, practiceQuiz.id, practiceQuestions);

    const afterFail = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(afterFail.status).toBe(200);
    const quizRow = afterFail.body.data.weeks[0].days[0].quizzes[0];
    expect(quizRow.status).toBe("FAILED");
    expect(quizRow.canRetry).toBe(false);
    expect(afterFail.body.data.weeks.find((week: { title: string }) => week.title === "Week 2").status).toBe("AVAILABLE");

    const catalog = await request(app)
      .get(`/api/v1/trainee/assessments/${practiceQuiz.id}`)
      .set("Cookie", traineeCookie);
    expect(catalog.body.data.assessment.status).toBe("FAILED");
    expect(catalog.body.data.passed).toBe(false);
    expect(catalog.body.data.canStart).toBe(false);
    expect(catalog.body.data.bestScore).toBe(0);

    const progress = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/progress`)
      .set("Cookie", traineeCookie);
    expect(progress.body.data.overall.percent).toBeLessThan(100);
    const quizItem = progress.body.data.items.find((item: { id: string }) => item.id === practiceQuiz.id);
    expect(quizItem.status).toBe("FAILED");
    expect(quizItem.earnedWeight).toBe(quizItem.weight);
    expect(progress.body.data.course.outcome).toBe("PENDING");
    expect(progress.body.data.course.courseStatus).toBe("IN_PROGRESS");

    const week2Lesson = afterFail.body.data.weeks
      .find((week: { title: string }) => week.title === "Week 2")
      .days[0].items.find((item: { type: string }) => item.type === "LESSON");
    expect(
      (await request(app).post(`/api/v1/trainee/items/LESSON/${week2Lesson.id}/complete`).set("Cookie", traineeCookie)).status,
    ).toBe(200);

    const finished = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(finished.body.data.progress.percent).toBe(100);
    expect(finished.body.data.course.outcome).toBe("FAILED");
    expect(finished.body.data.course.courseStatus).toBe("FINISHED");
    expect(finished.body.data.enrollment.status).toBe("ACTIVE");
    expect(finished.body.data.course.failedAssessments[0].id).toBe(practiceQuiz.id);

    const enrollments = await request(app).get("/api/v1/trainee/enrollments").set("Cookie", traineeCookie);
    const summary = enrollments.body.data.enrollments.find((row: { program: { id: string } }) => row.program.id === programId);
    expect(summary.course.outcome).toBe("FAILED");
    expect(summary.progress.percent).toBe(100);

    const cert = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/certificate`)
      .set("Cookie", traineeCookie);
    expect(cert.body.data.eligible).toBe(false);
    expect(cert.body.data.certificate).toBeNull();
    expect(
      cert.body.data.requirements.some(
        (row: { key: string; met: boolean }) => row.key === "PROGRAM_COMPLETION" && !row.met,
      ),
    ).toBe(true);

    const roster = await request(app)
      .get(`/api/v1/trainer/programs/${programId}/trainees`)
      .set("Cookie", trainerCookie);
    expect(roster.status).toBe(200);
    expect(roster.body.data.counts.failed).toBe(1);
    expect(roster.body.data.counts.completed).toBe(0);
    expect(roster.body.data.trainees[0].courseOutcome).toBe("FAILED");
    expect(roster.body.data.trainees[0].progress).toBe(100);

    const details = await request(app)
      .get(`/api/v1/trainer/enrollments/${roster.body.data.trainees[0].enrollmentId}/progress`)
      .set("Cookie", trainerCookie);
    expect(details.status).toBe(200);
    expect(details.body.data.progress.course.outcome).toBe("FAILED");
  });

  it("marks a fully passed course as PASSED and completed", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Passed Gate Track",
        description: "Pass then finish",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 1,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;
    const weekId = (
      await request(app).post(`/api/v1/trainer/programs/${programId}/weeks`).set("Cookie", trainerCookie).send({ title: "Week 1" })
    ).body.data.program.weeks[0].id as string;
    const dayId = (
      await request(app).post(`/api/v1/trainer/weeks/${weekId}/days`).set("Cookie", trainerCookie).send({ title: "Day 1" })
    ).body.data.program.weeks[0].days[0].id as string;
    await request(app)
      .post(`/api/v1/trainer/days/${dayId}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Lesson 1", required: true });
    const practice = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({ title: "Pass quiz", passingScore: 70, maxAttempts: 1, questions: [oneQuestion()] });
    const practiceQuiz = practice.body.data.program.weeks[0].days[0].quizzes[0];
    const practiceQuestions = practiceQuiz.questions as QuestionNode[];

    await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const learn = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    const lesson = learn.body.data.weeks[0].days[0].items.find((item: { type: string }) => item.type === "LESSON");
    expect(
      (await request(app).post(`/api/v1/trainee/items/LESSON/${lesson.id}/complete`).set("Cookie", traineeCookie)).status,
    ).toBe(200);

    const started = await request(app).post(`/api/v1/trainee/assessments/${practiceQuiz.id}/attempts`).set("Cookie", traineeCookie);
    const submitted = await request(app)
      .post(`/api/v1/trainee/attempts/${started.body.data.attempt.id}/submit`)
      .set("Cookie", traineeCookie)
      .send({
        answers: practiceQuestions.map((question) => ({
          questionId: question.id,
          optionIds: [question.options.find((option) => option.isCorrect)!.id],
        })),
      });
    expect(submitted.body.data.attempt.passed).toBe(true);

    const done = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(done.body.data.progress.percent).toBe(100);
    expect(done.body.data.course.outcome).toBe("PASSED");
    expect(done.body.data.enrollment.status).toBe("COMPLETED");

    const roster = await request(app)
      .get(`/api/v1/trainer/programs/${programId}/trainees`)
      .set("Cookie", trainerCookie);
    expect(roster.body.data.counts.completed).toBe(1);
    expect(roster.body.data.trainees[0].courseOutcome).toBe("PASSED");
  });
});
