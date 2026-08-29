import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";
import { enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-link`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "Link Admin", email: `link.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "Link Trainer", email: `link.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "Link Trainee", email: `link.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
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

describe("linked file assignments unlock in sequence", () => {
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

  it("shows one file, then its assignment, then the next file", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: "Metals Track",
        description: "File then assignment",
        category: "Trade",
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

    const funda = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/resources`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Funda",
        url: "https://example.com/funda.pdf",
        kind: "DOCUMENT",
        required: true,
      });
    expect(funda.status).toBe(200);
    const fundaId = funda.body.data.program.weeks[0].days[0].resources[0].id as string;

    const ametall = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/resources`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Ametall",
        url: "https://example.com/ametall.pdf",
        kind: "DOCUMENT",
        required: true,
      });
    expect(ametall.status).toBe(200);
    const resources = ametall.body.data.program.weeks[0].days[0].resources as Array<{ id: string; title: string }>;
    const ametallId = resources.find((item) => item.title === "Ametall")!.id;

    const assignment1 = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/assignments`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Funda worksheet",
        maxScore: 100,
        linkedItemType: "RESOURCE",
        linkedItemId: fundaId,
      });
    expect(assignment1.status).toBe(200);
    expect(assignment1.body.data.program.weeks[0].days[0].assignments[0].linkedItemId).toBe(fundaId);

    const assignment2 = await request(app)
      .post(`/api/v1/trainer/days/${dayId}/assignments`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Ametall worksheet",
        maxScore: 100,
        linkedItemType: "RESOURCE",
        linkedItemId: ametallId,
      });
    expect(assignment2.status).toBe(200);
    const assignments = assignment2.body.data.program.weeks[0].days[0].assignments as Array<{
      id: string;
      title: string;
      linkedItemId: string;
    }>;
    const fundaAssignmentId = assignments.find((item) => item.title === "Funda worksheet")!.id;
    const ametallAssignmentId = assignments.find((item) => item.title === "Ametall worksheet")!.id;

    await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
    await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const start = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(start.status).toBe(200);
    const day = start.body.data.weeks[0].days[0];
    const fundaItem = day.items.find((item: { id: string }) => item.id === fundaId);
    const ametallItem = day.items.find((item: { id: string }) => item.id === ametallId);
    const fundaWork = day.assignments.find((item: { id: string }) => item.id === fundaAssignmentId);
    const ametallWork = day.assignments.find((item: { id: string }) => item.id === ametallAssignmentId);
    expect(fundaItem.status).toBe("AVAILABLE");
    expect(fundaWork.status).toBe("LOCKED");
    expect(ametallItem.status).toBe("LOCKED");
    expect(ametallWork.status).toBe("LOCKED");

    const completed = await request(app)
      .post(`/api/v1/trainee/items/RESOURCE/${fundaId}/complete`)
      .set("Cookie", traineeCookie);
    expect(completed.status).toBe(200);
    const afterFile = completed.body.data.weeks[0].days[0];
    expect(afterFile.items.find((item: { id: string }) => item.id === fundaId).status).toBe("COMPLETED");
    expect(afterFile.assignments.find((item: { id: string }) => item.id === fundaAssignmentId).status).toBe("AVAILABLE");
    expect(afterFile.items.find((item: { id: string }) => item.id === ametallId).status).toBe("LOCKED");
    expect(completed.body.data.nextActivity.id).toBe(fundaAssignmentId);

    const submitted = await request(app)
      .post(`/api/v1/trainee/assignments/${fundaAssignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "Completed Funda work", submit: true });
    expect(submitted.status).toBe(200);

    const afterAssignment = await request(app)
      .get(`/api/v1/trainee/programs/${programId}/learn`)
      .set("Cookie", traineeCookie);
    expect(afterAssignment.status).toBe(200);
    const nextDay = afterAssignment.body.data.weeks[0].days[0];
    expect(nextDay.items.find((item: { id: string }) => item.id === ametallId).status).toBe("AVAILABLE");
    expect(nextDay.assignments.find((item: { id: string }) => item.id === ametallAssignmentId).status).toBe("LOCKED");
    expect(afterAssignment.body.data.nextActivity.id).toBe(ametallId);
  });
});
