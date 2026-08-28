import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";

const app = createApp();

const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const password = "TestPass123!";

const accounts = {
  admin: {
    name: "Test Admin",
    email: `phase2.test.admin.${suffix}@lms.local`,
    role: Role.SUPER_ADMIN,
  },
  ops: {
    name: "Test Ops",
    email: `phase2.test.ops.${suffix}@lms.local`,
    role: Role.ADMIN,
  },
  trainer: {
    name: "Test Trainer",
    email: `phase2.test.trainer.${suffix}@lms.local`,
    role: Role.TRAINER,
  },
  trainee: {
    name: "Test Trainee",
    email: `phase2.test.trainee.${suffix}@lms.local`,
    role: Role.TRAINEE,
  },
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

describe("authentication and RBAC", () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(password);

    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({
        ...account,
        passwordHash,
      })),
    });
  });

  afterAll(async () => {
    const emails = Object.values(accounts).map((account) => account.email);
    await prisma.session.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: emails } },
    });
  });

  it("logs in with valid credentials and does not return a password hash", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: accounts.admin.email,
      password,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(accounts.admin.email);
    expect(response.body.data.user.role).toBe(Role.SUPER_ADMIN);
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("rejects invalid credentials with a generic error", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: accounts.admin.email,
      password: "WrongPass123!",
    });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(response.body.error.message).toBe("Invalid email or password");
  });

  it("rejects unauthenticated API requests", async () => {
    const response = await request(app).get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the current user for an authenticated session", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({
      email: accounts.trainer.email,
      password,
    });
    const cookie = cookieFrom(login);

    const response = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(accounts.trainer.email);
    expect(response.body.data.user.role).toBe(Role.TRAINER);
  });

  it("prevents a trainee from accessing trainer endpoints", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({
      email: accounts.trainee.email,
      password,
    });
    const cookie = cookieFrom(login);

    const response = await request(app).get("/api/v1/trainer/programs").set("Cookie", cookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("prevents a trainer from accessing admin endpoints", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({
      email: accounts.trainer.email,
      password,
    });
    const cookie = cookieFrom(login);

    const response = await request(app).get("/api/v1/admin/users").set("Cookie", cookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows an admin to access admin endpoints", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({
      email: accounts.admin.email,
      password,
    });
    const cookie = cookieFrom(login);

    const response = await request(app).get("/api/v1/admin/users").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.users)).toBe(true);
    expect(
      response.body.data.users.some((user: { email: string }) => user.email === accounts.admin.email),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("lets an operational admin use operations APIs but not super-admin-only routes", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({
      email: accounts.ops.email,
      password,
    });
    const cookie = cookieFrom(login);

    expect((await request(app).get("/api/v1/admin/operations").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/v1/admin/users").set("Cookie", cookie)).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/dashboard").set("Cookie", cookie)).status).toBe(403);
  });

  it("lets a trainer upload a profile picture without changing other details", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({
      email: accounts.trainer.email,
      password,
    });
    const cookie = cookieFrom(login);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    const response = await request(app)
      .post("/api/v1/auth/avatar")
      .set("Cookie", cookie)
      .attach("file", png, { filename: "avatar.png", contentType: "image/png" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(accounts.trainer.email);
    expect(response.body.data.user.name).toBe(accounts.trainer.name);
    expect(response.body.data.user.role).toBe(Role.TRAINER);
    expect(response.body.data.user.avatarUrl).toMatch(/\/uploads\/avatars\/.+\.png$/);

    const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(me.body.data.user.avatarUrl).toBe(response.body.data.user.avatarUrl);

    const image = await request(app).get(response.body.data.user.avatarUrl as string);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toMatch(/image\//);
  });

  it("rejects a non-image profile picture", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({
      email: accounts.trainee.email,
      password,
    });
    const cookie = cookieFrom(login);

    const response = await request(app)
      .post("/api/v1/auth/avatar")
      .set("Cookie", cookie)
      .attach("file", Buffer.from("not an image"), { filename: "notes.txt", contentType: "text/plain" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });
});
