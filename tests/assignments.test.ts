import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { cookieFrom, enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-assign`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Assign Admin", email: `assign.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Assign Trainer", email: `assign.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  otherTrainer: { name: "Assign Other Trainer", email: `assign.othertrainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "Assign Trainee", email: `assign.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  other: { name: "Assign Other", email: `assign.other.${suffix}@lms.local`, role: Role.TRAINEE },
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("assignment submissions, files, and grading", () => {
  let programId = "";
  let dayId = "";
  let assignmentId = "";
  let lateAssignmentId = "";
  let resubmitAssignmentId = "";
  let changesAssignmentId = "";

  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);

    const created = await request(app).post("/api/v1/trainer/programs").set("Cookie", trainerCookie).send({
      title: `Assignment Program ${suffix}`,
      description: "Assignment lifecycle",
      category: "Web",
      difficulty: "BEGINNER",
      durationWeeks: 1,
      trainingMode: "PROGRESSION",
    });
    expect(created.status).toBe(201);
    programId = created.body.data.program.id;
    const week = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    expect(week.status).toBe(200);
    const day = await request(app)
      .post(`/api/v1/trainer/weeks/${week.body.data.program.weeks[0].id}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    expect(day.status).toBe(200);
    dayId = day.body.data.program.weeks[0].days[0].id as string;

    const assignment = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/assignments`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Build a REST API",
        description: "Express + PostgreSQL",
        instructions: "CRUD, validation, errors",
        maxScore: 100,
        allowFileUpload: true,
        allowTextResponse: true,
        allowLateSubmission: true,
        allowResubmission: false,
        maxAttempts: 3,
      });
    expect(assignment.status).toBe(200);
    assignmentId = assignment.body.data.program.weeks[0].days[0].assignments[0].id as string;

    const late = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/assignments`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Late blocked",
        maxScore: 50,
        allowLateSubmission: false,
        dueDate: new Date(Date.now() - 86_400_000).toISOString(),
      });
    expect(late.status).toBe(200);
    lateAssignmentId = late.body.data.program.weeks[0].days[0].assignments[1].id as string;

    const resubmit = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/assignments`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Resubmittable",
        maxScore: 100,
        allowResubmission: true,
        maxAttempts: 2,
      });
    expect(resubmit.status).toBe(200);
    resubmitAssignmentId = resubmit.body.data.program.weeks[0].days[0].assignments[2].id as string;

    const changes = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/assignments`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Needs a rewrite",
        maxScore: 100,
        allowResubmission: true,
        maxAttempts: 3,
      });
    expect(changes.status).toBe(200);
    changesAssignmentId = changes.body.data.program.weeks[0].days[0].assignments[3].id as string;

    const submitted = await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    expect(submitted.status).toBe(200);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.assignmentSubmissionFile.deleteMany({
      where: { submission: { enrollment: { user: { email: { in: emails } } } } },
    });
    await prisma.assignmentSubmission.deleteMany({ where: { enrollment: { user: { email: { in: emails } } } } });
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("lets a trainee save a draft, upload a file, submit, and a trainer grade", async () => {
    const traineeCookie = await login(accounts.trainee.email);
    const trainerCookie = await login(accounts.trainer.email);
    const otherCookie = await login(accounts.other.email);
    const otherTrainerCookie = await login(accounts.otherTrainer.email);

    const empty = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "   ", submit: true });
    expect(empty.status).toBe(400);

    const draft = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "I implemented the API using Express", submit: false });
    expect(draft.status).toBe(200);
    expect(draft.body.data.submission.status).toBe("IN_PROGRESS");
    const submissionId = draft.body.data.submission.id as string;

    const uploaded = await request(app)
      .post(`/api/v1/trainee/submissions/${submissionId}/files`)
      .set("Cookie", traineeCookie)
      .attach("file", Buffer.from("report contents"), { filename: "report.txt", contentType: "text/plain" });
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.body.data.file.id as string;
    expect(uploaded.body.data.file.fileName).toBe("report.txt");

    const submitted = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "I implemented the API using Express", submit: true });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.submission.status).toBe("SUBMITTED");
    expect(submitted.body.data.submission.files).toHaveLength(1);

    const peerFile = await request(app)
      .get(`/api/v1/trainee/submissions/${submissionId}/files/${fileId}`)
      .set("Cookie", otherCookie);
    expect(peerFile.status).toBe(404);

    const otherTrainerFile = await request(app)
      .get(`/api/v1/trainer/submissions/${submissionId}/files/${fileId}`)
      .set("Cookie", otherTrainerCookie);
    expect([403, 404]).toContain(otherTrainerFile.status);

    const trainerFile = await request(app)
      .get(`/api/v1/trainer/submissions/${submissionId}/files/${fileId}`)
      .set("Cookie", trainerCookie);
    expect(trainerFile.status).toBe(200);
    expect(trainerFile.text).toContain("report contents");

    const roster = await request(app).get(`/api/v1/trainer/assignments/${assignmentId}`).set("Cookie", trainerCookie);
    expect(roster.status).toBe(200);
    expect(roster.body.data.roster.some((row: { status: string }) => row.status === "SUBMITTED")).toBe(true);
    expect(
      roster.body.data.roster.every(
        (row: { enrollmentId: string; batch?: { id: string; name: string } }) =>
          Boolean(row.enrollmentId) && Boolean(row.batch?.id) && Boolean(row.batch?.name),
      ),
    ).toBe(true);

    const otherTrainerReview = await request(app)
      .post(`/api/v1/trainer/submissions/${submissionId}/review`)
      .set("Cookie", otherTrainerCookie)
      .send({ status: "GRADED", score: 10, comment: "Nope" });
    expect(otherTrainerReview.status).toBe(403);

    const overScore = await request(app)
      .post(`/api/v1/trainer/submissions/${submissionId}/review`)
      .set("Cookie", trainerCookie)
      .send({ status: "GRADED", score: 200, comment: "Too high" });
    expect(overScore.status).toBe(400);

    const graded = await request(app)
      .post(`/api/v1/trainer/submissions/${submissionId}/review`)
      .set("Cookie", trainerCookie)
      .send({ status: "GRADED", score: 87, comment: "Good implementation overall." });
    expect(graded.status).toBe(200);
    expect(graded.body.data.submission.score).toBe(87);

    const view = await request(app).get(`/api/v1/trainee/assignments/${assignmentId}`).set("Cookie", traineeCookie);
    expect(view.status).toBe(200);
    expect(view.body.data.submission.score).toBe(87);
    expect(view.body.data.submission.trainerComment).toContain("Good implementation");
    expect(JSON.stringify(view.body)).not.toContain("fileKey");
    expect(JSON.stringify(view.body)).not.toContain("passwordHash");
  });

  it("blocks unenrolled trainees, late work, and overwrites of closed attempts", async () => {
    const traineeCookie = await login(accounts.trainee.email);
    const otherCookie = await login(accounts.other.email);

    const unenrolled = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", otherCookie)
      .send({ body: "Nope", submit: true });
    expect([403, 404]).toContain(unenrolled.status);

    const late = await request(app)
      .post(`/api/v1/trainee/assignments/${lateAssignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "Too late", submit: true });
    expect(late.status).toBe(400);
    expect(late.body.error.message).toMatch(/late/i);

    const second = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "Should not overwrite graded work", submit: true });
    expect(second.status).toBe(403);
    expect(second.body.error.message).toMatch(/resubmission/i);
  });

  it("keeps previous attempts when resubmission is enabled", async () => {
    const traineeCookie = await login(accounts.trainee.email);
    const trainerCookie = await login(accounts.trainer.email);

    const first = await request(app)
      .post(`/api/v1/trainee/assignments/${resubmitAssignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "Attempt one", submit: true });
    expect(first.status).toBe(200);
    const firstId = first.body.data.submission.id as string;

    const graded = await request(app)
      .post(`/api/v1/trainer/submissions/${firstId}/review`)
      .set("Cookie", trainerCookie)
      .send({ status: "GRADED", score: 72, comment: "Improve validation." });
    expect(graded.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/trainee/assignments/${resubmitAssignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "Attempt two", submit: true });
    expect(second.status).toBe(200);
    expect(second.body.data.submission.revision).toBe(2);
    expect(second.body.data.submission.id).not.toBe(firstId);

    const catalog = await request(app)
      .get(`/api/v1/trainee/assignments/${resubmitAssignmentId}`)
      .set("Cookie", traineeCookie);
    expect(catalog.body.data.attempts).toHaveLength(2);
    expect(catalog.body.data.attempts.some((row: { id: string; score: number | null }) => row.id === firstId && row.score === 72)).toBe(
      true,
    );
  });

  it("notifies the trainee when a trainer requests changes", async () => {
    const traineeCookie = await login(accounts.trainee.email);
    const trainerCookie = await login(accounts.trainer.email);

    const submitted = await request(app)
      .post(`/api/v1/trainee/assignments/${changesAssignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "Attempt for changes", submit: true });
    expect(submitted.status).toBe(200);

    const reviewed = await request(app)
      .post(`/api/v1/trainer/submissions/${submitted.body.data.submission.id}/review`)
      .set("Cookie", trainerCookie)
      .send({ status: "CHANGES_REQUESTED", comment: "Please add validation." });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.submission.status).toBe("CHANGES_REQUESTED");

    const inbox = await request(app).get("/api/v1/trainee/notifications").set("Cookie", traineeCookie);
    expect(inbox.status).toBe(200);
    const note = (inbox.body.data.notifications as Array<{ title: string; body: string; read: boolean }>).find((row) =>
      row.title.startsWith("Changes requested:"),
    );
    expect(note).toMatchObject({
      title: "Changes requested: Needs a rewrite",
      read: false,
    });
    expect(note?.body).toContain("Please add validation.");

    const listed = await request(app).get("/api/v1/trainee/announcements").set("Cookie", traineeCookie);
    const titles = (listed.body.data.announcements as Array<{ title: string }>).map((row) => row.title);
    expect(titles).toContain("Changes requested: Needs a rewrite");

    const otherCookie = await login(accounts.other.email);
    const otherList = await request(app).get("/api/v1/trainee/announcements").set("Cookie", otherCookie);
    const otherTitles = (otherList.body.data.announcements as Array<{ title: string }>).map((row) => row.title);
    expect(otherTitles).not.toContain("Changes requested: Needs a rewrite");
  });
});
