import { Role } from "../src/generated/prisma";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { fileStorage } from "../src/storage";
import { hashPassword } from "../src/utils/password";
import { cookieFrom, enrollTraineeByEmail } from "./helpers";

const app = createApp();
const suffix = `${Date.now()}-files`;
const password = "TestPass123!";

const accounts = {
  admin: { name: "File Admin", email: `files.admin.${suffix}@lms.local`, role: Role.SUPER_ADMIN },
  trainer: { name: "File Trainer", email: `files.trainer.${suffix}@lms.local`, role: Role.TRAINER },
  otherTrainer: { name: "Other Trainer", email: `files.trainer2.${suffix}@lms.local`, role: Role.TRAINER },
  trainee: { name: "File Trainee", email: `files.trainee.${suffix}@lms.local`, role: Role.TRAINEE },
  otherTrainee: { name: "Other Trainee", email: `files.trainee2.${suffix}@lms.local`, role: Role.TRAINEE },
};

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("stored file uploads, access, and authorization", () => {
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

  it("stores trainer content in object storage and gates every read", async () => {
    const trainerCookie = await login(accounts.trainer.email);
    const otherTrainerCookie = await login(accounts.otherTrainer.email);
    const adminCookie = await login(accounts.admin.email);
    const traineeCookie = await login(accounts.trainee.email);
    const otherTraineeCookie = await login(accounts.otherTrainee.email);

    const created = await request(app)
      .post("/api/v1/trainer/programs")
      .set("Cookie", trainerCookie)
      .send({
        title: `File Program ${suffix}`,
        description: "Program used for storage tests",
        category: "Web",
        difficulty: "BEGINNER",
        durationWeeks: 2,
        trainingMode: "PROGRESSION",
      });
    expect(created.status).toBe(201);
    const programId = created.body.data.program.id as string;

    const week1 = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 1" });
    const week1Id = week1.body.data.program.weeks[0].id as string;

    const week2 = await request(app)
      .post(`/api/v1/trainer/programs/${programId}/weeks`)
      .set("Cookie", trainerCookie)
      .send({ title: "Week 2" });
    const week2Id = (week2.body.data.program.weeks as Array<{ id: string; title: string }>).find(
      (week) => week.title === "Week 2",
    )!.id;

    const day1 = await request(app).post(`/api/v1/trainer/weeks/${week1Id}/days`).set("Cookie", trainerCookie).send({ title: "Day 1" });
    const day1Id = day1.body.data.program.weeks.find((week: { id: string }) => week.id === week1Id).days[0].id as string;

    const day2 = await request(app).post(`/api/v1/trainer/weeks/${week2Id}/days`).set("Cookie", trainerCookie).send({ title: "Day 1" });
    const day2Id = day2.body.data.program.weeks.find((week: { id: string }) => week.id === week2Id).days[0].id as string;

    // Trainer uploads a PDF for day 1.
    const upload = await request(app)
      .post("/api/v1/trainer/uploads/files")
      .set("Cookie", trainerCookie)
      .field("purpose", "RESOURCE")
      .field("dayId", day1Id)
      .attach("file", PDF_BYTES, { filename: "network-security.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);
    const uploaded = upload.body.data.file as {
      key: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      storageProvider: string;
    };
    expect(uploaded.key).toContain(`programs/${programId}/weeks/${week1Id}/days/${day1Id}/`);
    expect(uploaded.fileName).toBe("network-security.pdf");
    expect(await fileStorage.exists(uploaded.key)).toBe(true);

    // Executables are rejected regardless of the client-declared MIME type.
    const blocked = await request(app)
      .post("/api/v1/trainer/uploads/files")
      .set("Cookie", trainerCookie)
      .field("purpose", "RESOURCE")
      .field("dayId", day1Id)
      .attach("file", Buffer.from("MZ"), { filename: "payload.exe", contentType: "application/pdf" });
    expect(blocked.status).toBe(400);

    // A trainer without access to this program cannot upload into it.
    const foreignUpload = await request(app)
      .post("/api/v1/trainer/uploads/files")
      .set("Cookie", otherTrainerCookie)
      .field("purpose", "RESOURCE")
      .field("dayId", day1Id)
      .attach("file", PDF_BYTES, { filename: "sneaky.pdf", contentType: "application/pdf" });
    expect(foreignUpload.status).toBe(403);

    // The upload metadata is saved on a resource in the existing curriculum model.
    const resourceRes = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/resources`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Network Security Fundamentals",
        kind: "DOCUMENT",
        required: true,
        fileKey: uploaded.key,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        fileSize: uploaded.fileSize,
      });
    expect(resourceRes.status).toBe(200);
    const resourceId = resourceRes.body.data.program.weeks
      .find((week: { id: string }) => week.id === week1Id)
      .days[0].resources[0].id as string;

    const storedResource = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(storedResource.fileKey).toBe(uploaded.key);
    expect(storedResource.mimeType).toBe("application/pdf");
    expect(storedResource.storageProvider).toBe(fileStorage.provider);

    const adminOnDraft = await request(app)
      .get(`/api/v1/admin/items/RESOURCE/${resourceId}/file`)
      .set("Cookie", adminCookie);
    expect([403, 404]).toContain(adminOnDraft.status);

    // Lesson attachment upload.
    const lessonRes = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Welcome", description: "Start here", durationMin: 5 });
    const lessonId = lessonRes.body.data.program.weeks.find((week: { id: string }) => week.id === week1Id).days[0]
      .lessons[0].id as string;

    const attachmentRes = await request(app)
      .post(`/api/v1/trainer/lessons/${lessonId}/attachments`)
      .set("Cookie", trainerCookie)
      .attach("file", PDF_BYTES, { filename: "handout.pdf", contentType: "application/pdf" });
    expect(attachmentRes.status).toBe(201);
    const attachmentId = attachmentRes.body.data.attachment.id as string;
    const attachmentRow = await prisma.contentAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(await fileStorage.exists(attachmentRow.fileKey)).toBe(true);

    // Locked content in week 2 for later checks.
    const lockedLessonRes = await request(app)
      .post(`/api/v1/trainer/days/${day2Id}/lessons`)
      .set("Cookie", trainerCookie)
      .send({ title: "Advanced", description: "Later", durationMin: 5 });
    const lockedLessonId = lockedLessonRes.body.data.program.weeks.find((week: { id: string }) => week.id === week2Id)
      .days[0].lessons[0].id as string;
    const lockedAttachment = await request(app)
      .post(`/api/v1/trainer/lessons/${lockedLessonId}/attachments`)
      .set("Cookie", trainerCookie)
      .attach("file", PDF_BYTES, { filename: "later.pdf", contentType: "application/pdf" });
    expect(lockedAttachment.status).toBe(201);
    const lockedAttachmentId = lockedAttachment.body.data.attachment.id as string;

    // Assignment with an instructions attachment.
    const assignmentRes = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/assignments`)
      .set("Cookie", trainerCookie)
      .send({ title: "Write about Network Security", description: "Explain the basics", maxScore: 100 });
    const assignmentId = assignmentRes.body.data.program.weeks.find((week: { id: string }) => week.id === week1Id)
      .days[0].assignments[0].id as string;

    const assignmentAttachment = await request(app)
      .post(`/api/v1/trainer/assignments/${assignmentId}/attachments`)
      .set("Cookie", trainerCookie)
      .attach("file", PDF_BYTES, { filename: "guidelines.pdf", contentType: "application/pdf" });
    expect(assignmentAttachment.status).toBe(201);

    // Trainer can preview their own stored file.
    const trainerAccess = await request(app)
      .get(`/api/v1/trainer/items/RESOURCE/${resourceId}/file`)
      .set("Cookie", trainerCookie);
    expect(trainerAccess.status).toBe(200);
    expect(trainerAccess.body.data.fileName).toBe("network-security.pdf");
    expect(["signed", "stream"]).toContain(trainerAccess.body.data.strategy);

    const foreignTrainerAccess = await request(app)
      .get(`/api/v1/trainer/items/RESOURCE/${resourceId}/file`)
      .set("Cookie", otherTrainerCookie);
    expect([403, 404]).toContain(foreignTrainerAccess.status);

    const anonymousAccess = await request(app).get(`/api/v1/trainer/items/RESOURCE/${resourceId}/file`);
    expect(anonymousAccess.status).toBe(401);

    // Replacing/removing content while the program is editable also cleans up storage.
    const throwaway = await request(app)
      .post("/api/v1/trainer/uploads/files")
      .set("Cookie", trainerCookie)
      .field("purpose", "RESOURCE")
      .field("dayId", day1Id)
      .attach("file", PDF_BYTES, { filename: "temp.pdf", contentType: "application/pdf" });
    expect(throwaway.status).toBe(201);
    const throwawayKey = throwaway.body.data.file.key as string;

    const throwawayResource = await request(app)
      .post(`/api/v1/trainer/days/${day1Id}/resources`)
      .set("Cookie", trainerCookie)
      .send({
        title: "Temporary handout",
        kind: "DOCUMENT",
        fileKey: throwawayKey,
        fileName: "temp.pdf",
        mimeType: "application/pdf",
        fileSize: PDF_BYTES.length,
      });
    expect(throwawayResource.status).toBe(200);
    const throwawayResourceId = (
      throwawayResource.body.data.program.weeks
        .find((week: { id: string }) => week.id === week1Id)
        .days[0].resources as Array<{ id: string; fileName: string | null }>
    ).find((row) => row.fileName === "temp.pdf")!.id;

    const deletedResource = await request(app)
      .delete(`/api/v1/trainer/resources/${throwawayResourceId}`)
      .set("Cookie", trainerCookie);
    expect(deletedResource.status).toBe(200);
    expect(await fileStorage.exists(throwawayKey)).toBe(false);

    const throwawayAttachment = await request(app)
      .post(`/api/v1/trainer/lessons/${lessonId}/attachments`)
      .set("Cookie", trainerCookie)
      .attach("file", PDF_BYTES, { filename: "draft-notes.pdf", contentType: "application/pdf" });
    expect(throwawayAttachment.status).toBe(201);
    const throwawayAttachmentId = throwawayAttachment.body.data.attachment.id as string;
    const throwawayAttachmentKey = (
      await prisma.contentAttachment.findUniqueOrThrow({ where: { id: throwawayAttachmentId } })
    ).fileKey;

    const removedAttachment = await request(app)
      .delete(`/api/v1/trainer/attachments/${throwawayAttachmentId}`)
      .set("Cookie", trainerCookie);
    expect(removedAttachment.status).toBe(200);
    expect(await prisma.contentAttachment.findUnique({ where: { id: throwawayAttachmentId } })).toBeNull();
    expect(await fileStorage.exists(throwawayAttachmentKey)).toBe(false);

    // Publish and enroll one trainee only.
    await request(app).post(`/api/v1/programs/${programId}/submit`).set("Cookie", trainerCookie);

    const adminAccess = await request(app)
      .get(`/api/v1/admin/items/RESOURCE/${resourceId}/file`)
      .set("Cookie", adminCookie);
    expect(adminAccess.status).toBe(200);
    expect(adminAccess.body.data.fileName).toBe("network-security.pdf");
    expect(["signed", "stream"]).toContain(adminAccess.body.data.strategy);

    const adminStream = await request(app)
      .get(`/api/v1/admin/items/RESOURCE/${resourceId}/file/stream`)
      .set("Cookie", adminCookie);
    expect(adminStream.status).toBe(200);
    expect(adminStream.headers["content-type"]).toContain("application/pdf");

    const adminAttachment = await request(app)
      .get(`/api/v1/admin/attachments/${attachmentId}/file`)
      .set("Cookie", adminCookie);
    expect(adminAttachment.status).toBe(200);

    await request(app).post(`/api/v1/programs/${programId}/approve`).set("Cookie", adminCookie);
    await enrollTraineeByEmail(app, trainerCookie, programId, accounts.trainee.email);

    const learn = await request(app).get(`/api/v1/trainee/programs/${programId}/learn`).set("Cookie", traineeCookie);
    expect(learn.status).toBe(200);
    const learnWeek1 = learn.body.data.weeks.find((week: { title: string }) => week.title === "Week 1");
    const resourceItem = learnWeek1.days[0].items.find(
      (item: { type: string; id: string }) => item.type === "RESOURCE" && item.id === resourceId,
    );
    // Stored files never leak a raw storage URL to the client.
    expect(resourceItem.url).toBeUndefined();
    expect(resourceItem.file).toMatchObject({ fileName: "network-security.pdf", mimeType: "application/pdf" });
    const lessonItem = learnWeek1.days[0].items.find((item: { type: string }) => item.type === "LESSON");
    expect(lessonItem.attachments?.[0]?.fileName).toBe("handout.pdf");

    // Enrolled trainee reads unlocked content.
    const traineeAccess = await request(app)
      .get(`/api/v1/trainee/items/RESOURCE/${resourceId}/file`)
      .set("Cookie", traineeCookie);
    expect(traineeAccess.status).toBe(200);

    const traineeStream = await request(app)
      .get(`/api/v1/trainee/items/RESOURCE/${resourceId}/file/stream`)
      .set("Cookie", traineeCookie);
    expect(traineeStream.status).toBe(200);
    expect(traineeStream.headers["content-type"]).toContain("application/pdf");

    const traineeAttachment = await request(app)
      .get(`/api/v1/trainee/attachments/${attachmentId}/file`)
      .set("Cookie", traineeCookie);
    expect(traineeAttachment.status).toBe(200);

    // Locked content stays locked.
    const lockedAccess = await request(app)
      .get(`/api/v1/trainee/attachments/${lockedAttachmentId}/file`)
      .set("Cookie", traineeCookie);
    expect(lockedAccess.status).toBe(403);

    // A trainee who is not enrolled gets nothing.
    const outsiderAccess = await request(app)
      .get(`/api/v1/trainee/items/RESOURCE/${resourceId}/file`)
      .set("Cookie", otherTraineeCookie);
    expect([403, 404]).toContain(outsiderAccess.status);

    const outsiderAttachment = await request(app)
      .get(`/api/v1/trainee/attachments/${attachmentId}/file`)
      .set("Cookie", otherTraineeCookie);
    expect([403, 404]).toContain(outsiderAttachment.status);

    // Trainees cannot manage trainer files.
    const traineeDelete = await request(app).delete(`/api/v1/trainer/attachments/${attachmentId}`).set("Cookie", traineeCookie);
    expect(traineeDelete.status).toBe(403);

    // A locked assignment hides its attachments entirely.
    const lockedCatalog = await request(app)
      .get(`/api/v1/trainee/assignments/${assignmentId}`)
      .set("Cookie", traineeCookie);
    expect(lockedCatalog.status).toBe(200);
    expect(lockedCatalog.body.data.assignment.status).toBe("LOCKED");
    expect(lockedCatalog.body.data.assignment.attachments).toEqual([]);

    // Finish the day's required content so the assignment unlocks.
    for (const item of learnWeek1.days[0].items as Array<{ id: string; type: string; required: boolean }>) {
      if (item.required) {
        const completed = await request(app)
          .post(`/api/v1/trainee/items/${item.type}/${item.id}/complete`)
          .set("Cookie", traineeCookie);
        expect(completed.status).toBe(200);
      }
    }

    // Assignment submission: upload, own it, and keep other trainees out.
    const assignmentCatalog = await request(app)
      .get(`/api/v1/trainee/assignments/${assignmentId}`)
      .set("Cookie", traineeCookie);
    expect(assignmentCatalog.status).toBe(200);
    expect(assignmentCatalog.body.data.assignment.attachments?.[0]?.fileName).toBe("guidelines.pdf");

    const draft = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "My answer", submit: false });
    expect([200, 201]).toContain(draft.status);
    const submissionId = draft.body.data.submission.id as string;

    const submissionUpload = await request(app)
      .post(`/api/v1/trainee/submissions/${submissionId}/files`)
      .set("Cookie", traineeCookie)
      .attach("file", PDF_BYTES, { filename: "assignment.pdf", contentType: "application/pdf" });
    expect(submissionUpload.status).toBe(201);
    const submissionFileId = submissionUpload.body.data.file.id as string;
    const submissionFile = await prisma.assignmentSubmissionFile.findUniqueOrThrow({ where: { id: submissionFileId } });
    expect(submissionFile.fileKey).toContain(`submissions/${assignmentId}/trainee/`);
    expect(await fileStorage.exists(submissionFile.fileKey)).toBe(true);

    const ownFileAccess = await request(app)
      .get(`/api/v1/trainee/submissions/${submissionId}/files/${submissionFileId}/access`)
      .set("Cookie", traineeCookie);
    expect(ownFileAccess.status).toBe(200);

    const otherTraineeFileAccess = await request(app)
      .get(`/api/v1/trainee/submissions/${submissionId}/files/${submissionFileId}/access`)
      .set("Cookie", otherTraineeCookie);
    expect([403, 404]).toContain(otherTraineeFileAccess.status);

    const submitted = await request(app)
      .post(`/api/v1/trainee/assignments/${assignmentId}/submissions`)
      .set("Cookie", traineeCookie)
      .send({ body: "My answer", submit: true });
    expect([200, 201]).toContain(submitted.status);

    // The owning trainer can read the submitted file; an unrelated trainer cannot.
    const trainerFileAccess = await request(app)
      .get(`/api/v1/trainer/submissions/${submissionId}/files/${submissionFileId}/access`)
      .set("Cookie", trainerCookie);
    expect(trainerFileAccess.status).toBe(200);

    const foreignTrainerFileAccess = await request(app)
      .get(`/api/v1/trainer/submissions/${submissionId}/files/${submissionFileId}/access`)
      .set("Cookie", otherTrainerCookie);
    expect([403, 404]).toContain(foreignTrainerFileAccess.status);

    // Approved programs stay frozen: file edits follow the existing content rules.
    const frozenDelete = await request(app)
      .delete(`/api/v1/trainer/attachments/${attachmentId}`)
      .set("Cookie", trainerCookie);
    expect(frozenDelete.status).toBe(400);
    expect(await fileStorage.exists(attachmentRow.fileKey)).toBe(true);
  });
});
