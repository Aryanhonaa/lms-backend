import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword, verifyPassword } from "../src/utils/password";
import { cookieFrom, enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-users`;
const password = "TestPass123!";
const createdPassword = "NewUserPass123!";

const accounts = {
  superAdmin: { name: "Create Super", email: `create.super.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  admin: { name: "Create Admin", email: `create.admin.${suffix}@lms.local`, role: Role.ADMIN },
  trainer: { name: "Create Trainer", email: `create.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "Create Trainee", email: `create.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
};

const createdEmails: string[] = [];

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

async function createSubmittedProgram(trainerCookie: string, title: string) {
  const created = await request(app)
    .post("/api/v1/trainer/programs")
    .set("Cookie", trainerCookie)
    .send({
      title,
      description: "Account creation enrollment check",
      category: "Web",
      difficulty: "BEGINNER",
      durationWeeks: 1,
      trainingMode: "PROGRESSION",
    });
  expect(created.status).toBe(201);
  const programId = created.body.data.program.id as string;
  const week = await request(app)
    .post(`/api/v1/trainer/programs/${programId}/weeks`)
    .set("Cookie", trainerCookie)
    .send({ title: "Week 1" });
  expect(week.status).toBe(200);
  const submitted = await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);
  expect(submitted.status).toBe(200);
  return programId;
}

describe("user account creation", () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(accounts).map((account) => ({ ...account, passwordHash })),
    });
  });

  afterAll(async () => {
    const emails = [...Object.values(accounts).map((account) => account.email), ...createdEmails];
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("lets a super admin create admin, trainer, and trainee accounts that can log in", async () => {
    const cookie = await login(accounts.superAdmin.email);

    const createdAdminEmail = `created.admin.${suffix}@lms.local`;
    const createdTrainerEmail = `created.trainer.${suffix}@lms.local`;
    const createdTraineeEmail = `created.trainee.${suffix}@lms.local`;
    createdEmails.push(createdAdminEmail, createdTrainerEmail, createdTraineeEmail);

    const adminRes = await request(app).post("/api/v1/admin/users").set("Cookie", cookie).send({
      name: "Maya Ops",
      email: createdAdminEmail,
      role: Role.ADMIN,
      password: createdPassword,
    });
    expect(adminRes.status).toBe(201);
    expect(adminRes.body.success).toBe(true);
    expect(adminRes.body.data.user.email).toBe(createdAdminEmail);
    expect(adminRes.body.data.user.role).toBe(Role.ADMIN);
    expect(adminRes.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(adminRes.body)).not.toContain("passwordHash");
    expect(JSON.stringify(adminRes.body)).not.toContain(createdPassword);

    const trainerRes = await request(app).post("/api/v1/admin/users").set("Cookie", cookie).send({
      name: "Kai Trainer",
      email: createdTrainerEmail,
      role: Role.TRAINER,
      password: createdPassword,
    });
    expect(trainerRes.status).toBe(201);
    expect(trainerRes.body.data.user.role).toBe(Role.TRAINER);

    const traineeRes = await request(app).post("/api/v1/admin/users").set("Cookie", cookie).send({
      name: "Nia Trainee",
      email: createdTraineeEmail,
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(traineeRes.status).toBe(201);
    expect(traineeRes.body.data.user.role).toBe(Role.TRAINEE);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: createdTraineeEmail } });
    expect(stored.passwordHash).not.toBe(createdPassword);
    expect(await verifyPassword(createdPassword, stored.passwordHash)).toBe(true);
    expect(await prisma.enrollment.count({ where: { userId: stored.id } })).toBe(0);

    for (const email of [createdAdminEmail, createdTrainerEmail, createdTraineeEmail]) {
      const loginRes = await request(app).post("/api/v1/auth/login").send({ email, password: createdPassword });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.user.email).toBe(email);
      expect(loginRes.body.data.user.passwordHash).toBeUndefined();
    }

    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: createdAdminEmail, password: createdPassword });
    expect((await request(app).get("/api/v1/admin/operations").set("Cookie", cookieFrom(adminLogin))).status).toBe(200);
    expect((await request(app).get("/api/v1/admin/dashboard").set("Cookie", cookieFrom(adminLogin))).status).toBe(403);

    const trainerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: createdTrainerEmail, password: createdPassword });
    expect((await request(app).get("/api/v1/trainer/programs").set("Cookie", cookieFrom(trainerLogin))).status).toBe(200);

    const traineeLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: createdTraineeEmail, password: createdPassword });
    expect((await request(app).get("/api/v1/trainee/enrollments").set("Cookie", cookieFrom(traineeLogin))).status).toBe(
      200,
    );
    expect((await request(app).get("/api/v1/trainee/enrollments").set("Cookie", cookieFrom(traineeLogin))).body.data.enrollments)
      .toHaveLength(0);
  });

  it("lets an admin create trainers and trainees but not admins or super admins", async () => {
    const cookie = await login(accounts.admin.email);
    const trainerEmail = `ops.created.trainer.${suffix}@lms.local`;
    const traineeEmail = `ops.created.trainee.${suffix}@lms.local`;
    createdEmails.push(trainerEmail, traineeEmail);

    const trainerRes = await request(app).post("/api/v1/admin/users").set("Cookie", cookie).send({
      name: "Ops Trainer",
      email: trainerEmail,
      role: Role.TRAINER,
      password: createdPassword,
    });
    expect(trainerRes.status).toBe(201);

    const traineeRes = await request(app).post("/api/v1/admin/users").set("Cookie", cookie).send({
      name: "Ops Trainee",
      email: traineeEmail,
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(traineeRes.status).toBe(201);

    const adminRes = await request(app).post("/api/v1/admin/users").set("Cookie", cookie).send({
      name: "Blocked Admin",
      email: `blocked.admin.${suffix}@lms.local`,
      role: Role.ADMIN,
      password: createdPassword,
    });
    expect(adminRes.status).toBe(403);
    expect(adminRes.body.error.message).toBe("You don't have permission to create this account.");

    const superRes = await request(app).post("/api/v1/admin/users").set("Cookie", cookie).send({
      name: "Blocked Super",
      email: `blocked.super.${suffix}@lms.local`,
      role: Role.SUPER_ADMIN,
      password: createdPassword,
    });
    expect(superRes.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: `blocked.admin.${suffix}@lms.local` } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: `blocked.super.${suffix}@lms.local` } })).toBeNull();
  });

  it("rejects trainers, trainees, duplicates, and invalid input", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const traineeCookie = await login(accounts.trainee.email);
    const adminCookie = await login(accounts.admin.email);

    const trainerCreate = await request(app).post("/api/v1/admin/users").set("Cookie", trainerCookie).send({
      name: "Nope",
      email: `trainer.cannot.${suffix}@lms.local`,
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(trainerCreate.status).toBe(403);

    const traineeCreate = await request(app).post("/api/v1/admin/users").set("Cookie", traineeCookie).send({
      name: "Nope",
      email: `trainee.cannot.${suffix}@lms.local`,
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(traineeCreate.status).toBe(403);

    const unauthenticated = await request(app).post("/api/v1/admin/users").send({
      name: "Nope",
      email: `anon.${suffix}@lms.local`,
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(unauthenticated.status).toBe(401);

    const duplicate = await request(app).post("/api/v1/admin/users").set("Cookie", adminCookie).send({
      name: "Duplicate",
      email: accounts.trainee.email,
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toBe("An account with this email already exists.");

    const invalidEmail = await request(app).post("/api/v1/admin/users").set("Cookie", adminCookie).send({
      name: "Bad Email",
      email: "not-an-email",
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(invalidEmail.status).toBe(400);
  });

  it("does not enroll a newly created trainee until a trainer enrolls them", async () => {
    const adminCookie = await login(accounts.admin.email);
    const trainerCookie = await login(accounts.trainer.email);
    const email = `later.enrolled.${suffix}@lms.local`;
    createdEmails.push(email);

    const created = await request(app).post("/api/v1/admin/users").set("Cookie", adminCookie).send({
      name: "Later Enrolled",
      email,
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(created.status).toBe(201);
    const userId = created.body.data.user.id as string;
    expect(await prisma.enrollment.count({ where: { userId } })).toBe(0);

    const programId = await createSubmittedProgram(trainerCookie, `Enroll later ${suffix}`);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie)).status).toBe(200);

    await enrollTraineeByEmail(app, trainerCookie, programId, email);
    expect(await prisma.enrollment.count({ where: { userId, programId } })).toBe(1);
  });
});

describe("user deletion", () => {
  const deleteSuffix = `${Date.now()}-udel`;
  const deleteAccounts = {
    superAdmin: { name: "Delete Super", email: `delete.super.${deleteSuffix}@lms.local`, role: Role.SUPER_ADMIN },
    extraSuper: { name: "Delete Extra Super", email: `delete.extra.super.${deleteSuffix}@lms.local`, role: Role.SUPER_ADMIN },
    admin: { name: "Delete Admin", email: `delete.admin.${deleteSuffix}@lms.local`, role: Role.ADMIN },
    otherAdmin: { name: "Other Admin", email: `delete.other.admin.${deleteSuffix}@lms.local`, role: Role.ADMIN },
    trainer: { name: "Delete Trainer", email: `delete.trainer.${deleteSuffix}@lms.local`, role: Role.TRAINER },
    spareTrainer: { name: "Spare Trainer", email: `delete.spare.trainer.${deleteSuffix}@lms.local`, role: Role.TRAINER },
    trainee: { name: "Delete Trainee", email: `delete.trainee.${deleteSuffix}@lms.local`, role: Role.TRAINEE },
    peerTrainee: { name: "Peer Trainee", email: `delete.peer.trainee.${deleteSuffix}@lms.local`, role: Role.TRAINEE },
  };
  const leftoverEmails: string[] = [];

  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: Object.values(deleteAccounts).map((account) => ({ ...account, passwordHash })),
    });
  });

  afterAll(async () => {
    const emails = [...Object.values(deleteAccounts).map((account) => account.email), ...leftoverEmails];
    await prisma.enrollment.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.program.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("lets a super admin delete an unused trainee and an admin delete an unused trainer", async () => {
    const superCookie = await login(deleteAccounts.superAdmin.email);
    const adminCookie = await login(deleteAccounts.admin.email);
    const traineeEmail = `gone.trainee.${deleteSuffix}@lms.local`;
    const trainerEmail = `gone.trainer.${deleteSuffix}@lms.local`;
    leftoverEmails.push(traineeEmail, trainerEmail);

    const traineeRes = await request(app).post("/api/v1/admin/users").set("Cookie", superCookie).send({
      name: "Gone Trainee",
      email: traineeEmail,
      role: Role.TRAINEE,
      password: createdPassword,
    });
    expect(traineeRes.status).toBe(201);
    const traineeId = traineeRes.body.data.user.id as string;

    const trainerRes = await request(app).post("/api/v1/admin/users").set("Cookie", adminCookie).send({
      name: "Gone Trainer",
      email: trainerEmail,
      role: Role.TRAINER,
      password: createdPassword,
    });
    expect(trainerRes.status).toBe(201);
    const trainerId = trainerRes.body.data.user.id as string;

    const deleted = await request(app).delete(`/api/v1/admin/users/${traineeId}`).set("Cookie", superCookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);
    expect(await prisma.user.findUnique({ where: { id: traineeId } })).toBeNull();
    expect((await request(app).post("/api/v1/auth/login").send({ email: traineeEmail, password: createdPassword })).status).toBe(
      401,
    );

    const trainerDeleted = await request(app).delete(`/api/v1/admin/users/${trainerId}`).set("Cookie", adminCookie);
    expect(trainerDeleted.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: trainerId } })).toBeNull();
  });

  it("rejects unauthorized, self, missing, and privileged deletes", async () => {
    const superCookie = await login(deleteAccounts.superAdmin.email);
    const adminCookie = await login(deleteAccounts.admin.email);
    const trainerCookie = await login(deleteAccounts.trainer.email);
    const traineeCookie = await login(deleteAccounts.trainee.email);
    const superUser = await prisma.user.findUniqueOrThrow({ where: { email: deleteAccounts.superAdmin.email } });
    const otherAdmin = await prisma.user.findUniqueOrThrow({ where: { email: deleteAccounts.otherAdmin.email } });
    const extraSuper = await prisma.user.findUniqueOrThrow({ where: { email: deleteAccounts.extraSuper.email } });
    const trainee = await prisma.user.findUniqueOrThrow({ where: { email: deleteAccounts.trainee.email } });

    expect((await request(app).delete(`/api/v1/admin/users/${trainee.id}`)).status).toBe(401);
    expect((await request(app).delete(`/api/v1/admin/users/${trainee.id}`).set("Cookie", trainerCookie)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/users/${trainee.id}`).set("Cookie", traineeCookie)).status).toBe(403);

    const self = await request(app).delete(`/api/v1/admin/users/${superUser.id}`).set("Cookie", superCookie);
    expect(self.status).toBe(403);
    expect(self.body.error.message).toBe("You cannot delete your own account.");

    const adminVsAdmin = await request(app).delete(`/api/v1/admin/users/${otherAdmin.id}`).set("Cookie", adminCookie);
    expect(adminVsAdmin.status).toBe(403);
    expect(adminVsAdmin.body.error.message).toBe("You don't have permission to delete this account.");

    const adminVsSuper = await request(app).delete(`/api/v1/admin/users/${superUser.id}`).set("Cookie", adminCookie);
    expect(adminVsSuper.status).toBe(403);

    const missing = await request(app)
      .delete("/api/v1/admin/users/00000000-0000-4000-8000-000000000000")
      .set("Cookie", superCookie);
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe("User not found.");

    const invalid = await request(app).delete("/api/v1/admin/users/not-a-user").set("Cookie", superCookie);
    expect(invalid.status).toBe(404);

    const extraDeleted = await request(app).delete(`/api/v1/admin/users/${extraSuper.id}`).set("Cookie", superCookie);
    expect(extraDeleted.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: extraSuper.id } })).toBeNull();

    const already = await request(app).delete(`/api/v1/admin/users/${extraSuper.id}`).set("Cookie", superCookie);
    expect(already.status).toBe(404);
  });

  it("removes a trainee enrollment without deleting the program or other trainees", async () => {
    const superCookie = await login(deleteAccounts.superAdmin.email);
    const trainerCookie = await login(deleteAccounts.trainer.email);
    const target = await prisma.user.findUniqueOrThrow({ where: { email: deleteAccounts.trainee.email } });
    const peer = await prisma.user.findUniqueOrThrow({ where: { email: deleteAccounts.peerTrainee.email } });

    const programId = await createSubmittedProgram(trainerCookie, `Keep program ${deleteSuffix}`);
    expect((await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", superCookie)).status).toBe(200);
    await enrollTraineeByEmail(app, trainerCookie, programId, deleteAccounts.trainee.email);
    await enrollTraineeByEmail(app, trainerCookie, programId, deleteAccounts.peerTrainee.email);

    const deleted = await request(app).delete(`/api/v1/admin/users/${target.id}`).set("Cookie", superCookie);
    expect(deleted.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await prisma.enrollment.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.enrollment.count({ where: { userId: peer.id, programId } })).toBe(1);
    expect(await prisma.program.findUnique({ where: { id: programId } })).toBeTruthy();
  });

  it("refuses to delete a trainer who created a program", async () => {
    const superCookie = await login(deleteAccounts.superAdmin.email);
    const trainer = await prisma.user.findUniqueOrThrow({ where: { email: deleteAccounts.spareTrainer.email } });
    const trainerCookie = await login(deleteAccounts.spareTrainer.email);
    const programId = await createSubmittedProgram(trainerCookie, `Owned program ${deleteSuffix}`);

    const blocked = await request(app).delete(`/api/v1/admin/users/${trainer.id}`).set("Cookie", superCookie);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toBe("This user created programs and cannot be deleted.");
    expect(await prisma.user.findUnique({ where: { id: trainer.id } })).toBeTruthy();
    expect(await prisma.program.findUnique({ where: { id: programId } })).toBeTruthy();
  });
});
