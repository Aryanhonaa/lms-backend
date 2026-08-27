import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-p6`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "P6 Admin", email: `phase6.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "P6 Trainer", email: `phase6.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "P6 Trainee", email: `phase6.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
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

async function submitQuiz(cookie: string, quizId: string, questions: QuestionNode[], pass: boolean) {
  const started = await request(app).post(`/api/v1/trainee/assessments/${quizId}/attempts`).set("Cookie", cookie);
  expect([200, 201]).toContain(started.status);
  const submitted = await request(app)
    .post(`/api/v1/trainee/attempts/${started.body.data.attempt.id}/submit`)
    .set("Cookie", cookie)
    .send({ answers: pass ? correctIds(questions) : wrongIds(questions) });
  expect(submitted.status).toBe(200);
  return submitted;
}

describe("progress engine, unlock engine, and milestones", () => {
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

  it("unlocks PROGRESSION content, tracks failed assessments, and gates milestone and final exams", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Progression Track",
        description: "Phase 6 progression",
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

    const day1Res = await request(app)
      .post(`/api/v1/trainer/weeks/${week1Id}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    const day1Id = day1Res.body.data.program.weeks.find((week: { id: string }) => week.id === week1Id).days[0].id as string;
    const day2Res = await request(app)
      .post(`/api/v1/trainer/weeks/${week2Id}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    const day2Id = day2Res.body.data.program.weeks.find((week: { id: string }) => week.id === week2Id).days[0].id as string;

    await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Lesson 1", required: true });
    await request(app)
      .post(`/api/v1/trainer/days/${day2Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Lesson 2", required: true });

    const practice = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({ title: "Practice", passingScore: 70, maxAttempts: 2, questions: [oneQuestion("Practice?")] });
    const practiceQuiz = practice.body.data.program.weeks[0].days[0].quizzes[0];
    const practiceQuestions = practiceQuiz.questions as QuestionNode[];

    const weekly = await request(app)
      .post(`/api/v1/trainer/weeks/${week1Id}/weekly-quiz`)
      .set("Cookie", trainerCookie)
      .send({ title: "Weekly quiz", passingScore: 70, maxAttempts: 2, questions: [oneQuestion("Weekly?")] });
    const weeklyQuiz = weekly.body.data.program.weeks[0].quizzes[0];
    const weeklyQuestions = weeklyQuiz.questions as QuestionNode[];

    const assignment = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/assignments`)
      .set("Cookie", trainerCookie)
      .send({ title: "Build notes", maxScore: 100 });
    const assignmentId = assignment.body.data.program.weeks[0].days[0].assignments[0].id as string;

    const milestone = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/milestones`)
      .set("Cookie", trainerCookie)
      .send({ title: "Checkpoint", afterWeekIndex: 0 });
    const milestoneId = milestone.body.data.program.milestones[0].id as string;

    await request(app)
      .post(`/api/v1/trainer/milestones/${milestoneId}/requirements`)
      .set("Cookie", trainerCookie)
      .send({ label: "Complete week 1", kind: "WEEKS_COMPLETED", targetCount: 1 });
    await request(app)
      .post(`/api/v1/trainer/milestones/${milestoneId}/requirements`)
      .set("Cookie", trainerCookie)
      .send({ label: "Pass the weekly quiz", kind: "ASSESSMENTS_PASSED", targetCount: 1 });
    await request(app)
      .post(`/api/v1/trainer/milestones/${milestoneId}/requirements`)
      .set("Cookie", trainerCookie)
      .send({ label: "Assignment graded", kind: "ASSIGNMENTS_COMPLETE", targetCount: 1 });

    const exam = await request(app)
      .post(`/api/v1/trainer/milestones/${milestoneId}/exam`)
      .set("Cookie", trainerCookie)
      .send({ title: "Milestone exam", passingScore: 70, maxAttempts: 2, questions: [oneQuestion("Milestone?")] });
    const milestoneExam = exam.body.data.program.milestones[0].exam;
    const milestoneQuestions = milestoneExam.questions as QuestionNode[];

    const final = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/final-exam`)
      .set("Cookie", trainerCookie)
      .send({ title: "Final exam", passingScore: 70, maxAttempts: 1, questions: [oneQuestion("Final?")] });
    const finalExam = final.body.data.program.quizzes.find((quiz: { kind: string }) => quiz.kind === "FINAL_EXAM");

    await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const locked = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(locked.status).toBe(200);
    const week2 = locked.body.data.weeks.find((week: { title: string }) => week.title === "Week 2");
    expect(week2.status).toBe("LOCKED");
    expect(week2.reason).toContain("Complete Week 1");

    const practiceLocked = await request(app)
      .get(`/api/v1/trainee/assessments/${practiceQuiz.id}`)
      .set("Cookie", traineeCookie);
    expect(practiceLocked.body.data.assessment.status).toBe("LOCKED");
    expect(practiceLocked.body.data.assessment.reason).toContain("required lessons");
    expect(locked.body.data.weeks[0].days[0].quizzes[0].id).toBe(practiceQuiz.id);
    expect(locked.body.data.weeks[0].days[0].quizzes[0].status).toBe("LOCKED");
    expect(locked.body.data.weeks[0].days[0].assignments[0].id).toBe(assignmentId);

    const lesson = locked.body.data.weeks[0].days[0].items.find((item: { type: string }) => item.type === "LESSON");
    const completed = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${lesson.id}/complete`)
      .set("Cookie", traineeCookie);
    expect(completed.status).toBe(200);
    expect(completed.body.data.progress.percent).toBeGreaterThan(0);
    expect(completed.body.data.weeks[0].days[0].quizzes[0].status).toBe("AVAILABLE");
    expect(completed.body.data.nextActivity.type).toBe("QUIZ");
    expect(completed.body.data.nextActivity.id).toBe(practiceQuiz.id);

    const practiceOpen = await request(app)
      .get(`/api/v1/trainee/assessments/${practiceQuiz.id}`)
      .set("Cookie", traineeCookie);
    expect(practiceOpen.body.data.assessment.status).toBe("AVAILABLE");

    const failedPractice = await submitQuiz(traineeCookie, practiceQuiz.id, practiceQuestions, false);
    expect(failedPractice.body.data.attempt.passed).toBe(false);

    const failedCatalog = await request(app)
      .get(`/api/v1/trainee/assessments/${practiceQuiz.id}`)
      .set("Cookie", traineeCookie);
    expect(failedCatalog.body.data.assessment.status).toBe("FAILED");

    const assignmentLocked = await request(app)
      .get(`/api/v1/trainee/assignments/${assignmentId}`)
      .set("Cookie", traineeCookie);
    expect(assignmentLocked.body.data.assignment.status).toBe("LOCKED");

    const passedPractice = await submitQuiz(traineeCookie, practiceQuiz.id, practiceQuestions, true);
    expect(passedPractice.body.data.attempt.passed).toBe(true);

    const assignmentOpen = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "My notes", submit: true });
    expect(assignmentOpen.status).toBe(200);
    const submissionId = assignmentOpen.body.data.submission.id as string;
    expect(assignmentOpen.body.data.catalog.assignment.status).toBe("COMPLETED");

    const afterSubmit = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(afterSubmit.body.data.weeks[0].days[0].assignments[0].status).toBe("COMPLETED");

    const graded = await request(app)
      .post(`/api/v1/trainer/submissions/${submissionId}/review`)
      .set("Cookie", trainerCookie)
      .send({ status: "GRADED", score: 90, comment: "Good" });
    expect(graded.status).toBe(200);

    const failedWeekly = await submitQuiz(traineeCookie, weeklyQuiz.id, weeklyQuestions, false);
    expect(failedWeekly.body.data.attempt.passed).toBe(false);

    const stillLocked = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(stillLocked.body.data.weeks.find((week: { title: string }) => week.title === "Week 2").status).toBe("LOCKED");

    const milestoneLocked = await request(app)
      .post(`/api/v1/trainee/assessments/${milestoneExam.id}/attempts`)
      .set("Cookie", traineeCookie);
    expect(milestoneLocked.status).toBe(403);
    expect(milestoneLocked.body.error.code).toBe("CONTENT_LOCKED");

    const progressMissing = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/progress`)
      .set("Cookie", traineeCookie);
    expect(progressMissing.status).toBe(200);
    const assessmentsReq = progressMissing.body.data.milestones[0].requirements.find(
      (row: { kind: string }) => row.kind === "ASSESSMENTS_PASSED",
    );
    expect(assessmentsReq.display).toBe("Missing");
    expect(progressMissing.body.data.finalExam.eligible).toBe(false);
    expect(progressMissing.body.data.finalExam.requirements.some((row: { met: boolean }) => !row.met)).toBe(true);

    const passedWeekly = await submitQuiz(traineeCookie, weeklyQuiz.id, weeklyQuestions, true);
    expect(passedWeekly.body.data.attempt.passed).toBe(true);

    const unlocked = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(unlocked.body.data.weeks.find((week: { title: string }) => week.title === "Week 2").status).toBe("AVAILABLE");

    const progressReady = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/progress`)
      .set("Cookie", traineeCookie);
    const requirements = progressReady.body.data.milestones[0].requirements as Array<{ display: string }>;
    expect(requirements.every((row) => row.display === "Complete")).toBe(true);
    expect(progressReady.body.data.milestones[0].exam.status).not.toBe("LOCKED");

    const failedMilestone = await submitQuiz(traineeCookie, milestoneExam.id, milestoneQuestions, false);
    expect(failedMilestone.body.data.attempt.passed).toBe(false);

    const stillIneligible = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/progress`)
      .set("Cookie", traineeCookie);
    expect(stillIneligible.body.data.finalExam.eligible).toBe(false);

    const passedMilestone = await submitQuiz(traineeCookie, milestoneExam.id, milestoneQuestions, true);
    expect(passedMilestone.body.data.attempt.passed).toBe(true);

    const week2Lesson = unlocked.body.data.weeks
      .find((week: { title: string }) => week.title === "Week 2")
      .days[0].items.find((item: { type: string }) => item.type === "LESSON");
    const finishWeek2 = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${week2Lesson.id}/complete`)
      .set("Cookie", traineeCookie);
    expect(finishWeek2.status).toBe(200);

    const eligible = await request(app).get(`/api/v1/trainee/programs/${programId}/progress`).set("Cookie", traineeCookie);
    expect(eligible.body.data.finalExam.eligible).toBe(true);
    expect(eligible.body.data.finalExam.requirements.every((row: { met: boolean }) => row.met)).toBe(true);

    const finalStart = await request(app)
      .post(`/api/v1/trainee/assessments/${finalExam.id}/attempts`)
      .set("Cookie", traineeCookie);
    expect(finalStart.status).toBe(201);
  });

  it("unlocks SCHEDULED content by date, not by previous completion", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);

    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Scheduled Track",
        description: "Phase 6 scheduled",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 2,
        trainingMode: "SCHEDULED",
        startDate: past,
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;

    const week1Res = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1", startDate: past });
    const week1Id = week1Res.body.data.program.weeks[0].id as string;
    const week2Res = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 2", startDate: future });
    const week2Id = week2Res.body.data.program.weeks.find((week: { title: string }) => week.title === "Week 2").id as string;

    const day1 = await request(app)
      .post(`/api/v1/trainer/weeks/${week1Id}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    const day1Id = day1.body.data.program.weeks.find((week: { id: string }) => week.id === week1Id).days[0].id as string;
    const day2 = await request(app)
      .post(`/api/v1/trainer/weeks/${week2Id}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    const day2Id = day2.body.data.program.weeks.find((week: { id: string }) => week.id === week2Id).days[0].id as string;

    await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Scheduled lesson 1", description: "Open notes", required: true });
    await request(app)
      .post(`/api/v1/trainer/days/${day2Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Scheduled lesson 2", description: "FUTURE_SECRET", required: true });

    await request(app)
      .post(`/api/v1/trainer/programs/${programId}/final-exam`)
      .set("Cookie", trainerCookie)
      .send({ title: "Scheduled final", passingScore: 70, questions: [oneQuestion("Done?")] });

    await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const learn = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(learn.status).toBe(200);
    const week1 = learn.body.data.weeks.find((week: { title: string }) => week.title === "Week 1");
    const week2 = learn.body.data.weeks.find((week: { title: string }) => week.title === "Week 2");
    expect(week1.status).toBe("AVAILABLE");
    expect(week2.status).toBe("LOCKED");
    expect(week2.reason).toMatch(/opens on/i);
    expect(week2.days[0].items[0].description).toBeUndefined();

    const lockedComplete = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${week2.days[0].items[0].id}/complete`)
      .set("Cookie", traineeCookie);
    expect(lockedComplete.status).toBe(403);

    const completeWeek1 = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${week1.days[0].items[0].id}/complete`)
      .set("Cookie", traineeCookie);
    expect(completeWeek1.status).toBe(200);

    const stillLocked = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(stillLocked.body.data.weeks.find((week: { title: string }) => week.title === "Week 2").status).toBe("LOCKED");

    await prisma.week.update({
      where: { id: week2Id },
      data: { startDate: new Date(Date.now() - 60_000) },
    });

    const opened = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    const openedWeek2 = opened.body.data.weeks.find((week: { title: string }) => week.title === "Week 2");
    expect(openedWeek2.status).toBe("AVAILABLE");
    expect(openedWeek2.days[0].items[0].description).toBe("FUTURE_SECRET");

    const progress = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/progress`)
      .set("Cookie", traineeCookie);
    expect(progress.body.data.finalExam.eligible).toBe(false);
    expect(progress.body.data.weekProgress[0].reason).toBeNull();
  });
});
