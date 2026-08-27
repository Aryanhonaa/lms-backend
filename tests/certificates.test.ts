import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-p10`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "P10 Admin", email: `phase10.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "P10 Trainer", email: `phase10.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "P10 Trainee", email: `phase10.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  other: { name: "P10 Other", email: `phase10.other.${suffix}@lms.local`, role: Role.TRAINEE },
};

const ids = {
  eligibleProgramId: "",
  blockedProgramId: "",
  eligibleLessonId: "",
  blockedLessonId: "",
  blockedQuizId: "",
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

async function createLessonProgram(
  trainerCookie: string,
  adminCookie: string,
  title: string,
  withQuiz: boolean,
) {
  const created = await request(app)
    .post("/api/v1/trainer/programs")
    .set("Cookie", trainerCookie)
    .send({
      title,
      description: "Phase 10 certificates",
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
  const weekId = weekRes.body.data.program.weeks[0].id as string;
  const dayRes = await request(app)
    .post(`/api/v1/trainer/weeks/${weekId}/days`)
    .set("Cookie", trainerCookie)
    .send({ title: "Day 1" });
  const dayId = dayRes.body.data.program.weeks[0].days[0].id as string;
  const lessonRes = await request(app)
    .post(`/api/v1/trainer/days/${dayId}/lessons`)
    .set("Cookie", trainerCookie)
    .send({ title: "Capstone lesson", required: true });
  const lessonId = lessonRes.body.data.program.weeks[0].days[0].lessons[0].id as string;

  let quizId = "";
  if (withQuiz) {
    const quiz = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/practice-quiz`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Must pass",
        passingScore: 70,
        questions: [
          {
            prompt: "Ready?",
            options: [
              { label: "Yes", isCorrect: true },
              { label: "No", isCorrect: false },
            ],
          },
        ],
      });
    quizId = quiz.body.data.program.weeks[0].days[0].quizzes[0].id as string;
  }

  await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
  await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
  await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);
  return { programId, lessonId, quizId };
}

describe("certificates and public verification", () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });

    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const eligible = await createLessonProgram(trainerCookie, adminCookie, "Eligible Cert Track", false);
    const blocked = await createLessonProgram(trainerCookie, adminCookie, "Blocked Cert Track", true);
    ids.eligibleProgramId = eligible.programId;
    ids.eligibleLessonId = eligible.lessonId;
    ids.blockedProgramId = blocked.programId;
    ids.blockedLessonId = blocked.lessonId;
    ids.blockedQuizId = blocked.quizId;
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("issues when eligible, skips when not, prevents duplicates, verifies publicly, and revokes", async () => {
    const traineeCookie = await login(accounts.trainee.email);
    const otherCookie = await login(accounts.other.email);
    const adminCookie = await login(accounts.admin.email);

    await request(app).get(`/api/v1/trainee/programs/${ids.eligibleProgramId}/learn`).set("Cookie", traineeCookie);
    await request(app).get(`/api/v1/trainee/programs/${ids.blockedProgramId}/learn`).set("Cookie", traineeCookie);

    const ineligible = await request(app)
      .get(`/api/v1/trainee/programs/${ids.blockedProgramId}/certificate`)
      .set("Cookie", traineeCookie);
    expect(ineligible.status).toBe(200);
    expect(ineligible.body.data.eligible).toBe(false);
    expect(ineligible.body.data.certificate).toBeNull();
    expect(ineligible.body.data.requirements.some((row: { met: boolean }) => !row.met)).toBe(true);

    const completeBlockedLesson = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${ids.blockedLessonId}/complete`)
      .set("Cookie", traineeCookie);
    expect(completeBlockedLesson.status).toBe(200);

    const stillBlocked = await request(app)
      .get(`/api/v1/trainee/programs/${ids.blockedProgramId}/certificate`)
      .set("Cookie", traineeCookie);
    expect(stillBlocked.body.data.eligible).toBe(false);
    expect(stillBlocked.body.data.certificate).toBeNull();
    expect(
      stillBlocked.body.data.requirements.some(
        (row: { key: string; met: boolean }) => row.key.startsWith("ASSESSMENT:") && !row.met,
      ),
    ).toBe(true);

    const completeEligible = await request(app)
      .post(`/api/v1/trainee/items/LESSON/${ids.eligibleLessonId}/complete`)
      .set("Cookie", traineeCookie);
    expect(completeEligible.status).toBe(200);

    const waitingOnReview = await request(app)
      .get(`/api/v1/trainee/programs/${ids.eligibleProgramId}/certificate`)
      .set("Cookie", traineeCookie);
    expect(waitingOnReview.status).toBe(200);
    expect(waitingOnReview.body.data.eligible).toBe(false);
    expect(waitingOnReview.body.data.certificate).toBeNull();
    expect(waitingOnReview.body.data.pendingReview).toBe(true);
    expect(
      waitingOnReview.body.data.requirements.some(
        (row: { key: string; met: boolean }) => row.key === "COURSE_REVIEW" && !row.met,
      ),
    ).toBe(true);

    const listedBeforeReview = await request(app).get("/api/v1/trainee/certificates").set("Cookie", traineeCookie);
    expect(listedBeforeReview.body.data.certificates).toHaveLength(0);
    expect(listedBeforeReview.body.data.pendingReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          programId: ids.eligibleProgramId,
          programTitle: "Eligible Cert Track",
        }),
      ]),
    );

    const review = await request(app)
      .post("/api/v1/trainee/feedback")
      .set("Cookie", traineeCookie)
      .send({
        targetKind: "COURSE",
        targetId: ids.eligibleProgramId,
        rating: 5,
        comment: "Required course review.",
      });
    expect(review.status).toBe(201);

    const issued = await request(app)
      .get(`/api/v1/trainee/programs/${ids.eligibleProgramId}/certificate`)
      .set("Cookie", traineeCookie);
    expect(issued.status).toBe(200);
    expect(issued.body.data.eligible).toBe(true);
    expect(issued.body.data.pendingReview).toBe(false);
    expect(issued.body.data.certificate.certificateId).toMatch(/^LMS-[A-F0-9]{12}$/);
    expect(issued.body.data.certificate.status).toBe("VALID");
    const certificateId = issued.body.data.certificate.certificateId as string;

    await request(app)
      .post(`/api/v1/trainee/items/LESSON/${ids.eligibleLessonId}/complete`)
      .set("Cookie", traineeCookie);
    const again = await request(app)
      .get(`/api/v1/trainee/programs/${ids.eligibleProgramId}/certificate`)
      .set("Cookie", traineeCookie);
    expect(again.body.data.certificate.certificateId).toBe(certificateId);
    const listed = await request(app).get("/api/v1/trainee/certificates").set("Cookie", traineeCookie);
    const matches = listed.body.data.certificates.filter(
      (row: { certificateId: string }) => row.certificateId === certificateId,
    );
    expect(matches).toHaveLength(1);
    expect(listed.body.data.pendingReviews).toHaveLength(0);

    const mine = await request(app)
      .get(`/api/v1/trainee/certificates/${certificateId}`)
      .set("Cookie", traineeCookie);
    expect(mine.status).toBe(200);
    expect(mine.body.data.certificate.program.title).toBe("Eligible Cert Track");
    expect(mine.body.data.certificate.verificationUrl).toContain(certificateId);

    const peer = await request(app)
      .get(`/api/v1/trainee/certificates/${certificateId}`)
      .set("Cookie", otherCookie);
    expect(peer.status).toBe(404);

    const verified = await request(app).get(`/api/v1/verify/${certificateId}`);
    expect(verified.status).toBe(200);
    expect(verified.body.data.certificate).toEqual({
      certificateId,
      traineeName: accounts.trainee.name,
      program: "Eligible Cert Track",
      trainer: accounts.trainer.name,
      completionDate: verified.body.data.certificate.completionDate,
      status: "VALID",
    });
    expect(Object.keys(verified.body.data.certificate).sort()).toEqual(
      ["certificateId", "completionDate", "program", "status", "trainer", "traineeName"].sort(),
    );
    expect(JSON.stringify(verified.body)).not.toMatch(/@lms\.local/);
    expect(verified.body.data.certificate.email).toBeUndefined();
    expect(verified.body.data.certificate.finalScore).toBeUndefined();
    expect(verified.body.data.certificate.progressPercent).toBeUndefined();
    expect(verified.body.data.certificate.enrollmentId).toBeUndefined();
    expect(verified.body.data.certificate.traineeUserId).toBeUndefined();

    const missing = await request(app).get("/api/v1/verify/LMS-000000000000");
    expect(missing.status).toBe(404);

    const revoked = await request(app)
      .patch(`/api/v1/admin/certificates/${certificateId}`)
      .set("Cookie", adminCookie)
      .send({ reason: "Issued in error" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.certificate.status).toBe("REVOKED");

    const afterRevoke = await request(app).get(`/api/v1/verify/${certificateId}`);
    expect(afterRevoke.status).toBe(200);
    expect(afterRevoke.body.data.certificate.status).toBe("REVOKED");
    expect(afterRevoke.body.data.certificate.traineeName).toBe(accounts.trainee.name);

    const traineeRevoke = await request(app)
      .patch(`/api/v1/admin/certificates/${certificateId}`)
      .set("Cookie", traineeCookie)
      .send({ reason: "nope" });
    expect(traineeRevoke.status).toBe(403);
  });
});
