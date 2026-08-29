import request from "supertest";
import { expect } from "vitest";
import { prisma } from "../src/config/prisma";

type TestApp = Parameters<typeof request>[0];

export function cookieFrom(response: request.Response): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const session = cookies.find((value) => value.startsWith("lms_session="));
  if (!session) {
    throw new Error("Missing session cookie");
  }
  return session.split(";")[0];
}

export async function ensureTestBatch(app: TestApp, trainerCookie: string, programId: string, name = "Test run") {
  const listed = await request(app).get(`/api/v1/trainer/programs/${programId}/batches`).set("Cookie", trainerCookie);
  expect(listed.status).toBe(200);
  const existing = (listed.body.data.batches as Array<{ id: string; name: string }>).find((row) => row.name === name);
  if (existing) {
    return existing.id;
  }
  const created = await request(app)
    .post(`/api/v1/trainer/programs/${programId}/batches`)
    .set("Cookie", trainerCookie)
    .send({ name, capacity: 25 });
  expect(created.status).toBe(201);
  return created.body.data.batch.id as string;
}

export function mcqOptions(correct: string, wrong1 = "Option B", wrong2 = "Option C", wrong3 = "Option D") {
  return [
    { label: correct, isCorrect: true },
    { label: wrong1, isCorrect: false },
    { label: wrong2, isCorrect: false },
    { label: wrong3, isCorrect: false },
  ];
}

export async function enrollTraineeByEmail(
  app: TestApp,
  trainerCookie: string,
  programId: string,
  email: string,
  batchId?: string,
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const resolvedBatchId = batchId ?? (await ensureTestBatch(app, trainerCookie, programId));
  const response = await request(app)
    .post(`/api/v1/trainer/programs/${programId}/enrollments`)
    .set("Cookie", trainerCookie)
    .send({ traineeIds: [user.id], batchId: resolvedBatchId });
  expect(response.status).toBe(200);
  expect(response.body.data.enrolledCount).toBeGreaterThanOrEqual(1);
  return response;
}
