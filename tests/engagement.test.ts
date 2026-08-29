import {
  AssessmentAttemptStatus,
  ContentItemType,
  Role,
} from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail, mcqOptions } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-p9`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "P9 Admin", email: `phase9.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "P9 Trainer", email: `phase9.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  highProgress: { name: "P9 High Progress", email: `phase9.high.${suffix}@lms.local`, role: Role.TRAINEE },
  highScore: { name: "P9 High Score", email: `phase9.score.${suffix}@lms.local`, role: Role.TRAINEE },
  other: { name: "P9 Other", email: `phase9.other.${suffix}@lms.local`, role: Role.TRAINEE },
};

const ids = {
  programId: "",
  weekId: "",
  dayId: "",
  lessonIds: [] as string[],
  practiceId: "",
  examId: "",
  sessionId: "",
  highEnrollmentId: "",
  scoreEnrollmentId: "",
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

describe("engagement features", () => {
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
        title: "Engagement Track",
        description: "Phase 9 leaderboard",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 1,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    ids.programId = created.body.data.program.id as string;

    const weekRes = await request(app)
      .post(`/api/v1/trainer/programs/${ids.programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    ids.weekId = weekRes.body.data.program.weeks[0].id as string;

    const dayRes = await request(app)
      .post(`/api/v1/trainer/weeks/${ids.weekId}/days`)
      .set("Cookie", trainerCookie)
      .send({ title: "Day 1" });
    ids.dayId = dayRes.body.data.program.weeks[0].days[0].id as string;

    for (let index = 1; index <= 8; index += 1) {
      const lessonRes = await request(app)
        .post(`/api/v1/trainer/days/${ids.dayId}/lessons`)
        .set("Cookie", trainerCookie)
        .send({ title: `Lesson ${index}`, required: true });
      expect(lessonRes.status).toBe(200);
    }
    const afterLessons = await request(app)
      .get(`/api/v1/trainer/programs/${ids.programId}`)
      .set("Cookie", trainerCookie);
    ids.lessonIds = afterLessons.body.data.program.weeks[0].days[0].lessons.map((row: { id: string }) => row.id);

    const practice = await request(app)
      .post(`/api/v1/trainer/days/${ids.dayId}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Practice",
        passingScore: 70,
        questions: [
          {
            prompt: "2 + 2?",
            options: mcqOptions("4", "5", "6", "7"),
          },
        ],
      });
    ids.practiceId = practice.body.data.program.weeks[0].days[0].quizzes[0].id as string;

    const exam = await request(app)
      .post(`/api/v1/trainer/weeks/${ids.weekId}/weekly-exam`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Exam",
        passingScore: 70,
        questions: [
          {
            prompt: "1 + 1?",
            options: mcqOptions("2", "3", "4", "0"),
          },
        ],
      });
    ids.examId = exam.body.data.program.weeks[0].quizzes.find((quiz: { kind: string }) => quiz.kind === "WEEKLY_EXAM").id as string;

    await request(app)
      .post(`/api/v1/trainer/programs/${ids.programId}/milestones`)
      .set("Cookie", trainerCookie)
      .send({ title: "Checkpoint", afterWeekIndex: 0 });

    const sessionRes = await request(app)
      .post(`/api/v1/trainer/weeks/${ids.weekId}/sessions`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Studio",
        date: "2026-08-01",
        startTime: "09:00",
        endTime: "10:00",
      });
    ids.sessionId = sessionRes.body.data.program.weeks[0].trainingSessions[0].id as string;

    await request(app).post(`/api/v1/programs/${ids.programId}/submit`).set("Cookie", trainerCookie);
    await request(app).post(`/api/v1/programs/${ids.programId}/approve`).set("Cookie", adminCookie);

    await enrollTraineeByEmail(app, trainerCookie, ids.programId, accounts.highProgress.email);
    await enrollTraineeByEmail(app, trainerCookie, ids.programId, accounts.highScore.email);

    const highCookie = await login(accounts.highProgress.email);
    const scoreCookie = await login(accounts.highScore.email);
    await request(app).get(`/api/v1/trainee/programs/${ids.programId}/learn`).set("Cookie", highCookie);
    await request(app).get(`/api/v1/trainee/programs/${ids.programId}/learn`).set("Cookie", scoreCookie);

    const highUser = await prisma.user.findUniqueOrThrow({ where: { email: accounts.highProgress.email } });
    const scoreUser = await prisma.user.findUniqueOrThrow({ where: { email: accounts.highScore.email } });
    const highEnrollment = await prisma.enrollment.findFirstOrThrow({
      where: { programId: ids.programId, userId: highUser.id },
    });
    const scoreEnrollment = await prisma.enrollment.findFirstOrThrow({
      where: { programId: ids.programId, userId: scoreUser.id },
    });
    ids.highEnrollmentId = highEnrollment.id;
    ids.scoreEnrollmentId = scoreEnrollment.id;

    await prisma.contentCompletion.createMany({
      data: ids.lessonIds.map((itemId) => ({
        enrollmentId: ids.highEnrollmentId,
        itemType: ContentItemType.LESSON,
        itemId,
      })),
    });
    await prisma.contentCompletion.create({
      data: {
        enrollmentId: ids.scoreEnrollmentId,
        itemType: ContentItemType.LESSON,
        itemId: ids.lessonIds[0],
      },
    });
    await prisma.assessmentAttempt.createMany({
      data: [
        {
          enrollmentId: ids.scoreEnrollmentId,
          quizId: ids.practiceId,
          attemptNumber: 1,
          status: AssessmentAttemptStatus.SUBMITTED,
          submittedAt: new Date(),
          score: 100,
          passed: true,
          questionSnapshot: [],
        },
        {
          enrollmentId: ids.scoreEnrollmentId,
          quizId: ids.examId,
          attemptNumber: 1,
          status: AssessmentAttemptStatus.SUBMITTED,
          submittedAt: new Date(),
          score: 100,
          passed: true,
          questionSnapshot: [],
        },
      ],
    });
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.feedback.deleteMany({
      where: {
        OR: [{ author: { email: { in: emails } } }, { program: { createdBy: { email: { in: emails } } } }],
      },
    });
    await prisma.announcement.deleteMany({
      where: {
        OR: [{ createdBy: { email: { in: emails } } }, { program: { createdBy: { email: { in: emails } } } }],
      },
    });
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("ranks by blended score, hides peer raw scores, and awards event achievements", async () => {
    const highCookie = await login(accounts.highProgress.email);
    const scoreCookie = await login(accounts.highScore.email);
    const trainerCookie = await login(accounts.trainer.email);
    const otherCookie = await login(accounts.other.email);

    const board = await request(app)
      .get(`/api/v1/trainee/leaderboard?programId=${ids.programId}`)
      .set("Cookie", scoreCookie);
    expect(board.status).toBe(200);
    const entries = board.body.data.boards[0].entries as Array<{
      trainee: { id: string; name: string; email?: string };
      rank: number;
      score: number;
      progressPercent: number;
      breakdown?: unknown;
      bestScore?: unknown;
    }>;
    const highRow = entries.find((row) => row.trainee.name === accounts.highProgress.name);
    const scoreRow = entries.find((row) => row.trainee.name === accounts.highScore.name);
    expect(highRow).toBeTruthy();
    expect(scoreRow).toBeTruthy();
    expect(highRow!.progressPercent).toBeGreaterThan(scoreRow!.progressPercent);
    expect(scoreRow!.score).toBeGreaterThan(highRow!.score);
    expect(scoreRow!.rank).toBeLessThan(highRow!.rank);

    for (const row of entries) {
      expect(row.trainee.email).toBeUndefined();
      expect(row.breakdown).toBeUndefined();
      expect(row.bestScore).toBeUndefined();
      expect(Object.keys(row).sort()).toEqual(
        [
          "rank",
          "trainee",
          "score",
          "progressPercent",
          "quizzesPassed",
          "quizzesTotal",
          "examsPassed",
          "examsTotal",
          "milestonesComplete",
          "milestonesTotal",
        ].sort(),
      );
    }

    const you = board.body.data.boards[0].you;
    expect(you.breakdown).toBeTruthy();
    expect(you.breakdown.quiz).toBe(100);
    expect(you.breakdown.exam).toBe(100);
    expect(you.trainee.name).toBe(accounts.highScore.name);

    const peer = await request(app)
      .get(`/api/v1/trainee/leaderboard?programId=${ids.programId}`)
      .set("Cookie", highCookie);
    expect(peer.body.data.boards[0].you.breakdown.quiz).toBe(0);
    expect(peer.body.data.boards[0].you.breakdown.exam).toBe(0);

    const forbidden = await request(app).get("/api/v1/trainer/leaderboard").set("Cookie", scoreCookie);
    expect(forbidden.status).toBe(403);

    const trainerBoard = await request(app)
      .get(`/api/v1/trainer/leaderboard?programId=${ids.programId}`)
      .set("Cookie", trainerCookie);
    expect(trainerBoard.status).toBe(200);
    expect(trainerBoard.body.data.boards[0].you).toBeNull();
    const trainerEntry = trainerBoard.body.data.boards[0].entries[0];
    expect(trainerEntry.breakdown).toBeUndefined();
    expect(trainerEntry.trainee.email).toBeUndefined();

    const otherBoard = await request(app)
      .get(`/api/v1/trainee/leaderboard?programId=${ids.programId}`)
      .set("Cookie", otherCookie);
    expect([200, 404]).toContain(otherBoard.status);
    if (otherBoard.status === 200) {
      expect(otherBoard.body.data.boards[0].entries[0].breakdown).toBeUndefined();
    }

    await prisma.contentCompletion.update({
      where: {
        enrollmentId_itemType_itemId: {
          enrollmentId: ids.scoreEnrollmentId,
          itemType: ContentItemType.LESSON,
          itemId: ids.lessonIds[0],
        },
      },
      data: { completedAt: new Date("2026-08-01T12:00:00.000Z") },
    });
    await prisma.contentCompletion.createMany({
      data: [
        {
          enrollmentId: ids.scoreEnrollmentId,
          itemType: ContentItemType.LESSON,
          itemId: ids.lessonIds[1],
          completedAt: new Date("2026-08-02T12:00:00.000Z"),
        },
        {
          enrollmentId: ids.scoreEnrollmentId,
          itemType: ContentItemType.LESSON,
          itemId: ids.lessonIds[2],
          completedAt: new Date("2026-08-03T12:00:00.000Z"),
        },
      ],
    });

    const roster = await request(app)
      .get(`/api/v1/trainer/programs/${ids.programId}/attendance?sessionId=${ids.sessionId}`)
      .set("Cookie", trainerCookie);
    const scoreRoster = roster.body.data.roster.find(
      (row: { trainee: { email: string } }) => row.trainee.email === accounts.highScore.email,
    );
    await request(app)
      .put(`/api/v1/trainer/sessions/${ids.sessionId}/attendance`)
      .set("Cookie", trainerCookie)
      .send({ records: [{ enrollmentId: scoreRoster.enrollmentId, status: "PRESENT" }] });

    const achievements = await request(app).get("/api/v1/trainee/achievements").set("Cookie", scoreCookie);
    expect(achievements.status).toBe(200);
    const byKey = Object.fromEntries(
      (achievements.body.data.achievements as Array<{ key: string; earned: boolean }>).map((row) => [
        row.key,
        row.earned,
      ]),
    );
    expect(byKey.PERFECT_QUIZ).toBe(true);
    expect(byKey.EXAM_CHAMPION).toBe(true);
    expect(byKey.LEARNING_STREAK).toBe(true);
    expect(byKey.PERFECT_ATTENDANCE).toBe(true);
    expect(byKey.TOP_PERFORMER).toBe(true);

    const locked = await request(app).get("/api/v1/trainee/achievements").set("Cookie", highCookie);
    const highKeys = Object.fromEntries(
      (locked.body.data.achievements as Array<{ key: string; earned: boolean }>).map((row) => [row.key, row.earned]),
    );
    expect(highKeys.PERFECT_QUIZ).toBe(false);
    expect(highKeys.EXAM_CHAMPION).toBe(false);
    expect(highKeys.TOP_PERFORMER).toBe(false);
  });

  it("accepts trainee feedback, hides it from peers, and lets admin moderate", async () => {
    const scoreCookie = await login(accounts.highScore.email);
    const otherCookie = await login(accounts.other.email);
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);

    const options = await request(app).get("/api/v1/trainee/feedback/options").set("Cookie", scoreCookie);
    expect(options.status).toBe(200);
    expect(options.body.data.courses.some((row: { id: string }) => row.id === ids.programId)).toBe(true);

    const created = await request(app)
      .post("/api/v1/trainee/feedback")
      .set("Cookie", scoreCookie)
      .send({
        targetKind: "COURSE",
        targetId: ids.programId,
        rating: 5,
        comment: "Clear path.",
      });
    expect(created.status).toBe(201);
    expect(created.body.data.feedback.status).toBe("PENDING");
    expect(created.body.data.feedback.rating).toBe(5);
    const feedbackId = created.body.data.feedback.id as string;

    const peer = await request(app).get(`/api/v1/trainee/feedback/${feedbackId}`).set("Cookie", otherCookie);
    expect(peer.status).toBe(404);

    const trainerView = await request(app)
      .get(`/api/v1/trainer/feedback?programId=${ids.programId}`)
      .set("Cookie", trainerCookie);
    expect(trainerView.status).toBe(200);
    expect(trainerView.body.data.feedback.some((row: { id: string }) => row.id === feedbackId)).toBe(true);

    const moderated = await request(app)
      .patch(`/api/v1/admin/feedback/${feedbackId}`)
      .set("Cookie", adminCookie)
      .send({ status: "APPROVED" });
    expect(moderated.status).toBe(200);
    expect(moderated.body.data.feedback.status).toBe("APPROVED");

    const traineeModerate = await request(app)
      .patch(`/api/v1/admin/feedback/${feedbackId}`)
      .set("Cookie", scoreCookie)
      .send({ status: "HIDDEN" });
    expect(traineeModerate.status).toBe(403);
  });

  it("filters announcements by audience", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const scoreCookie = await login(accounts.highScore.email);

    const everyone = await request(app)
      .post("/api/v1/admin/announcements")
      .set("Cookie", adminCookie)
      .send({ title: "Platform note", body: "Visible to all.", audience: "EVERYONE" });
    expect(everyone.status).toBe(201);

    const trainersOnly = await request(app)
      .post("/api/v1/admin/announcements")
      .set("Cookie", adminCookie)
      .send({ title: "Trainer briefing", body: "Ops only.", audience: "TRAINERS" });
    expect(trainersOnly.status).toBe(201);

    const traineesOnly = await request(app)
      .post("/api/v1/admin/announcements")
      .set("Cookie", adminCookie)
      .send({ title: "Learner note", body: "For trainees.", audience: "TRAINEES" });
    expect(traineesOnly.status).toBe(201);

    const programNote = await request(app)
      .post("/api/v1/trainer/announcements")
      .set("Cookie", trainerCookie)
      .send({
        title: "Studio change",
        body: "Meet in room B.",
        audience: "PROGRAM",
        programId: ids.programId,
      });
    expect(programNote.status).toBe(201);

    const trainerWide = await request(app)
      .post("/api/v1/trainer/announcements")
      .set("Cookie", trainerCookie)
      .send({ title: "Nope", body: "Cannot broadcast.", audience: "EVERYONE" });
    expect(trainerWide.status).toBe(400);

    const traineeList = await request(app).get("/api/v1/trainee/announcements").set("Cookie", scoreCookie);
    const traineeTitles = (traineeList.body.data.announcements as Array<{ title: string }>).map((row) => row.title);
    expect(traineeTitles).toContain("Platform note");
    expect(traineeTitles).toContain("Learner note");
    expect(traineeTitles).toContain("Studio change");
    expect(traineeTitles).not.toContain("Trainer briefing");

    const trainerList = await request(app).get("/api/v1/trainer/announcements").set("Cookie", trainerCookie);
    const trainerTitles = (trainerList.body.data.announcements as Array<{ title: string }>).map((row) => row.title);
    expect(trainerTitles).toContain("Platform note");
    expect(trainerTitles).toContain("Trainer briefing");
    expect(trainerTitles).toContain("Studio change");
    expect(trainerTitles).not.toContain("Learner note");

    const highUser = await prisma.user.findUniqueOrThrow({ where: { email: accounts.highProgress.email } });
    const scoreUser = await prisma.user.findUniqueOrThrow({ where: { email: accounts.highScore.email } });
    const targetedEnrollment = await prisma.enrollment.findFirstOrThrow({
      where: { programId: ids.programId, userId: highUser.id },
    });
    const targeted = await request(app)
      .post("/api/v1/trainer/announcements")
      .set("Cookie", trainerCookie)
      .send({
        title: "Only high progress",
        body: "Catch up notes.",
        audience: "TRAINEES_SELECTED",
        programId: ids.programId,
        batchId: targetedEnrollment.batchId,
        traineeIds: [highUser.id],
      });
    expect(targeted.status).toBe(201);
    expect(targeted.body.data.announcement.recipients).toEqual([{ id: highUser.id, name: accounts.highProgress.name }]);

    const outsider = await request(app)
      .post("/api/v1/trainer/announcements")
      .set("Cookie", trainerCookie)
      .send({
        title: "Bad pick",
        body: "Not in batch.",
        audience: "TRAINEES_SELECTED",
        programId: ids.programId,
        batchId: targetedEnrollment.batchId,
        traineeIds: [scoreUser.id, "00000000-0000-4000-8000-000000000000"],
      });
    expect(outsider.status).toBe(400);

    const highCookie = await login(accounts.highProgress.email);
    const highList = await request(app).get("/api/v1/trainee/announcements").set("Cookie", highCookie);
    const highTitles = (highList.body.data.announcements as Array<{ title: string }>).map((row) => row.title);
    expect(highTitles).toContain("Only high progress");

    const scoreList = await request(app).get("/api/v1/trainee/announcements").set("Cookie", scoreCookie);
    const scoreTitles = (scoreList.body.data.announcements as Array<{ title: string }>).map((row) => row.title);
    expect(scoreTitles).not.toContain("Only high progress");
  });

  it("counts unread announcements on trainee and trainer notification bells", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const traineeCookie = await login(accounts.highScore.email);
    const title = `Bell note ${suffix}`;

    const created = await request(app)
      .post("/api/v1/admin/announcements")
      .set("Cookie", adminCookie)
      .send({ title, body: "Shows on the header bell.", audience: "TRAINEES" });
    expect(created.status).toBe(201);
    const announcementId = created.body.data.announcement.id as string;

    const traineeInbox = await request(app).get("/api/v1/trainee/notifications").set("Cookie", traineeCookie);
    expect(traineeInbox.status).toBe(200);
    expect(traineeInbox.body.data.unreadCount).toBeGreaterThan(0);
    const traineeItem = (traineeInbox.body.data.notifications as Array<{ id: string; title: string; read: boolean; href: string }>).find(
      (row) => row.id === announcementId,
    );
    expect(traineeItem).toMatchObject({ title, read: false, href: "/trainee/announcements" });

    const trainerInbox = await request(app).get("/api/v1/trainer/notifications").set("Cookie", trainerCookie);
    expect(trainerInbox.status).toBe(200);
    expect(
      (trainerInbox.body.data.notifications as Array<{ id: string }>).some((row) => row.id === announcementId),
    ).toBe(false);

    const ownNote = await request(app)
      .post("/api/v1/trainer/announcements")
      .set("Cookie", trainerCookie)
      .send({
        title: `Own studio ${suffix}`,
        body: "Author should not get an unread badge.",
        audience: "PROGRAM",
        programId: ids.programId,
      });
    expect(ownNote.status).toBe(201);
    const ownId = ownNote.body.data.announcement.id as string;
    const trainerAfterOwn = await request(app).get("/api/v1/trainer/notifications").set("Cookie", trainerCookie);
    const ownItem = (trainerAfterOwn.body.data.notifications as Array<{ id: string; read: boolean }>).find((row) => row.id === ownId);
    expect(ownItem?.read).toBe(true);

    const traineeAfterOwn = await request(app).get("/api/v1/trainee/notifications").set("Cookie", traineeCookie);
    const traineeOwn = (traineeAfterOwn.body.data.notifications as Array<{ id: string; read: boolean }>).find((row) => row.id === ownId);
    expect(traineeOwn?.read).toBe(false);

    const trainerBriefing = await request(app)
      .post("/api/v1/admin/announcements")
      .set("Cookie", adminCookie)
      .send({ title: `Trainer bell ${suffix}`, body: "Trainer inbox only.", audience: "TRAINERS" });
    expect(trainerBriefing.status).toBe(201);
    const briefingId = trainerBriefing.body.data.announcement.id as string;
    const trainerAfterBriefing = await request(app).get("/api/v1/trainer/notifications").set("Cookie", trainerCookie);
    expect(trainerAfterBriefing.body.data.unreadCount).toBeGreaterThan(0);
    expect(
      (trainerAfterBriefing.body.data.notifications as Array<{ id: string; read: boolean }>).some(
        (row) => row.id === briefingId && row.read === false,
      ),
    ).toBe(true);

    const marked = await request(app).post("/api/v1/trainee/notifications/read").set("Cookie", traineeCookie).send({});
    expect(marked.status).toBe(200);
    expect(marked.body.data.unreadCount).toBe(0);
    expect((marked.body.data.notifications as Array<{ read: boolean }>).every((row) => row.read)).toBe(true);

    const trainerMarked = await request(app)
      .post("/api/v1/trainer/notifications/read")
      .set("Cookie", trainerCookie)
      .send({ ids: [briefingId] });
    expect(trainerMarked.status).toBe(200);
    expect(
      (trainerMarked.body.data.notifications as Array<{ id: string; read: boolean }>).find((row) => row.id === briefingId)?.read,
    ).toBe(true);
  });
});
