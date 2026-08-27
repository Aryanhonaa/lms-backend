import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-p8`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "P8 Admin", email: `phase8.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "P8 Trainer", email: `phase8.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "P8 Trainee", email: `phase8.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  other: { name: "P8 Other", email: `phase8.other.${suffix}@lms.local`, role: Role.TRAINEE },
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

describe("attendance and calendar", () => {
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

  it("creates sessions, marks and updates attendance, computes percent, hides peer records, and lists calendar events", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);
    const otherCookie = await login(accounts.other.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Live Lab",
        description: "Phase 8 attendance",
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

    await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const learn = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(learn.status).toBe(200);

    const sessionRes = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/sessions`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Studio standup",
        date: "2026-08-01",
        startTime: "09:00",
        endTime: "10:30",
        meetingLink: "https://meet.example.com/lab",
        description: "Bring your notes.",
      });
    expect(sessionRes.status).toBe(200);
    const session = sessionRes.body.data.program.weeks[0].trainingSessions[0];
    expect(session.title).toBe("Studio standup");
    expect(session.description).toBe("Bring your notes.");
    const sessionId = session.id as string;

    const roster = await request(app)
      .get(`/api/v1/trainer/programs/${programId}/attendance?sessionId=${sessionId}`)
      .set("Cookie", trainerCookie);
    expect(roster.status).toBe(200);
    const mine = roster.body.data.roster.find((row: { trainee: { email: string } }) => row.trainee.email === accounts.trainee.email);
    expect(mine).toBeTruthy();
    const enrollmentId = mine.enrollmentId as string;

    const marked = await request(app)
      .put(`/api/v1/trainer/sessions/${sessionId}/attendance`)
      .set("Cookie", trainerCookie)
      .send({ records: [{ enrollmentId, status: "PRESENT" }] });
    expect(marked.status).toBe(200);
    const presentRow = marked.body.data.roster.find((row: { enrollmentId: string }) => row.enrollmentId === enrollmentId);
    expect(presentRow.status).toBe("PRESENT");
    expect(presentRow.attendancePercent).toBe(100);

    const updated = await request(app)
      .patch(`/api/v1/trainer/attendance/${presentRow.attendanceId}`)
      .set("Cookie", trainerCookie)
      .send({ status: "LATE" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.attendance.status).toBe("LATE");

    const afterUpdate = await request(app)
      .get(`/api/v1/trainer/programs/${programId}/attendance?sessionId=${sessionId}`)
      .set("Cookie", trainerCookie);
    const lateRow = afterUpdate.body.data.roster.find((row: { enrollmentId: string }) => row.enrollmentId === enrollmentId);
    expect(lateRow.status).toBe("LATE");
    expect(lateRow.attendancePercent).toBe(100);

    const second = await request(app)
      .post(`/api/v1/trainer/weeks/${weekId}/sessions`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Review lab",
        date: "2026-08-08",
        startTime: "14:00",
        endTime: "15:00",
      });
    const secondId = second.body.data.program.weeks[0].trainingSessions.find((row: { title: string }) => row.title === "Review lab").id as string;
    await request(app)
      .put(`/api/v1/trainer/sessions/${secondId}/attendance`)
      .set("Cookie", trainerCookie)
      .send({ records: [{ enrollmentId, status: "ABSENT" }] });

    const mixed = await request(app)
      .get(`/api/v1/trainer/programs/${programId}/attendance?sessionId=${secondId}`)
      .set("Cookie", trainerCookie);
    const mixedRow = mixed.body.data.roster.find((row: { enrollmentId: string }) => row.enrollmentId === enrollmentId);
    expect(mixedRow.attendancePercent).toBe(50);

    const traineeView = await request(app).get("/api/v1/trainee/attendance").set("Cookie", traineeCookie);
    expect(traineeView.status).toBe(200);
    const programView = traineeView.body.data.programs.find((row: { program: { id: string } }) => row.program.id === programId);
    expect(programView.attendancePercent).toBe(50);
    expect(programView.history.some((row: { session: { id: string }; status: string }) => row.session.id === sessionId && row.status === "LATE")).toBe(true);

    const otherView = await request(app).get("/api/v1/trainee/attendance").set("Cookie", otherCookie);
    expect(otherView.status).toBe(200);
    const otherProgram = otherView.body.data.programs.find((row: { program: { id: string } }) => row.program.id === programId);
    if (otherProgram) {
      expect(otherProgram.history.some((row: { status: string | null }) => row.status === "LATE" || row.status === "ABSENT")).toBe(false);
      expect(otherProgram.enrollmentId).not.toBe(enrollmentId);
    }

    const otherGet = await request(app)
      .get(`/api/v1/trainee/attendance/${lateRow.attendanceId}`)
      .set("Cookie", otherCookie);
    expect(otherGet.status).toBe(404);

    const trainerBlocked = await request(app)
      .get(`/api/v1/trainer/programs/${programId}/attendance`)
      .set("Cookie", otherCookie);
    expect(trainerBlocked.status).toBe(403);

    const calendar = await request(app).get("/api/v1/trainer/calendar").set("Cookie", trainerCookie);
    expect(calendar.status).toBe(200);
    expect(calendar.body.data.events.some((row: { title: string; type: string }) => row.title === "Studio standup" && row.type === "SESSION")).toBe(true);

    const traineeCalendar = await request(app).get("/api/v1/trainee/calendar").set("Cookie", traineeCookie);
    expect(traineeCalendar.status).toBe(200);
    expect(traineeCalendar.body.data.events.some((row: { title: string }) => row.title === "Studio standup")).toBe(true);
  });
});
