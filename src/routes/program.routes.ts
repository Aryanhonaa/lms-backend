import { Router } from "express";
import multer from "multer";
import { curriculumController } from "../controllers/curriculum.controller";
import { fileController } from "../controllers/file.controller";
import { env } from "../config/env";
import { enrollmentController } from "../controllers/enrollment.controller";
import { batchController } from "../controllers/batch.controller";
import { programController } from "../controllers/program.controller";
import { validateBody } from "../middleware/validate-body";
import { asyncHandler } from "../utils/async-handler";
import {
  assignmentSchema,
  batchSchema,
  confirmUploadSchema,
  createProgramSchema,
  daySchema,
  enrollIntoProgramSchema,
  enrollTraineesSchema,
  lessonSchema,
  milestoneSchema,
  quizSchema,
  reelSchema,
  requirementSchema,
  resourceSchema,
  sessionSchema,
  updateProgramSchema,
  updateReelSchema,
  updateResourceSchema,
  updateSessionSchema,
  updateVideoSchema,
  uploadTicketSchema,
  videoSchema,
  weekSchema,
} from "../validators/program.validators";

export const trainerProgramRouter = Router();

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxVideoUploadMb * 1024 * 1024 },
});
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxDocumentUploadMb * 1024 * 1024 },
});

trainerProgramRouter.get("/programs", asyncHandler(programController.listMine));
trainerProgramRouter.post("/programs", validateBody(createProgramSchema), asyncHandler(programController.create));
trainerProgramRouter.get("/programs/:programId/eligible-trainees", asyncHandler(enrollmentController.listEligible));
trainerProgramRouter.get("/programs/:programId/trainees", asyncHandler(enrollmentController.listProgramTrainees));
trainerProgramRouter.post(
  "/programs/:programId/enrollments",
  validateBody(enrollIntoProgramSchema),
  asyncHandler(enrollmentController.enroll),
);
trainerProgramRouter.get("/programs/:programId/batches", asyncHandler(batchController.list));
trainerProgramRouter.post(
  "/programs/:programId/batches",
  validateBody(batchSchema),
  asyncHandler(batchController.create),
);
trainerProgramRouter.patch(
  "/batches/:batchId",
  validateBody(batchSchema.partial()),
  asyncHandler(batchController.update),
);
trainerProgramRouter.delete("/batches/:batchId", asyncHandler(batchController.remove));
trainerProgramRouter.get("/batches/:batchId/trainees", asyncHandler(batchController.listTrainees));
trainerProgramRouter.post(
  "/batches/:batchId/enrollments",
  validateBody(enrollTraineesSchema),
  asyncHandler(batchController.enroll),
);
trainerProgramRouter.get("/programs/:programId", asyncHandler(programController.get));
trainerProgramRouter.patch(
  "/programs/:programId",
  validateBody(updateProgramSchema),
  asyncHandler(programController.update),
);
trainerProgramRouter.delete("/programs/:programId", asyncHandler(programController.remove));

trainerProgramRouter.post(
  "/programs/:programId/weeks",
  validateBody(weekSchema),
  asyncHandler(curriculumController.addWeek),
);
trainerProgramRouter.patch("/weeks/:weekId", validateBody(weekSchema.partial()), asyncHandler(curriculumController.updateWeek));
trainerProgramRouter.delete("/weeks/:weekId", asyncHandler(curriculumController.deleteWeek));

trainerProgramRouter.post("/weeks/:weekId/days", validateBody(daySchema), asyncHandler(curriculumController.addDay));
trainerProgramRouter.patch("/days/:dayId", validateBody(daySchema.partial()), asyncHandler(curriculumController.updateDay));
trainerProgramRouter.delete("/days/:dayId", asyncHandler(curriculumController.deleteDay));

trainerProgramRouter.post("/days/:dayId/lessons", validateBody(lessonSchema), asyncHandler(curriculumController.addLesson));
trainerProgramRouter.patch("/lessons/:lessonId", validateBody(lessonSchema.partial()), asyncHandler(curriculumController.updateLesson));
trainerProgramRouter.delete("/lessons/:lessonId", asyncHandler(curriculumController.deleteLesson));

trainerProgramRouter.post("/days/:dayId/videos", validateBody(videoSchema), asyncHandler(curriculumController.addVideo));
trainerProgramRouter.patch("/videos/:videoId", validateBody(updateVideoSchema), asyncHandler(curriculumController.updateVideo));
trainerProgramRouter.delete("/videos/:videoId", asyncHandler(curriculumController.deleteVideo));

trainerProgramRouter.post("/days/:dayId/resources", validateBody(resourceSchema), asyncHandler(curriculumController.addResource));
trainerProgramRouter.patch("/resources/:resourceId", validateBody(updateResourceSchema), asyncHandler(curriculumController.updateResource));
trainerProgramRouter.delete("/resources/:resourceId", asyncHandler(curriculumController.deleteResource));

trainerProgramRouter.post("/days/:dayId/reels", validateBody(reelSchema), asyncHandler(curriculumController.addReel));
trainerProgramRouter.patch("/reels/:reelId", validateBody(updateReelSchema), asyncHandler(curriculumController.updateReel));
trainerProgramRouter.delete("/reels/:reelId", asyncHandler(curriculumController.deleteReel));

// Cloudflare R2 uploads and authorized file access for authored content.
trainerProgramRouter.post("/uploads/files", mediaUpload.single("file"), asyncHandler(fileController.uploadTrainerFile));
trainerProgramRouter.post("/uploads/tickets", validateBody(uploadTicketSchema), asyncHandler(fileController.createUploadTicket));
trainerProgramRouter.post("/uploads/confirm", validateBody(confirmUploadSchema), asyncHandler(fileController.confirmUpload));
trainerProgramRouter.get("/items/:itemType/:itemId/file", asyncHandler(fileController.trainerItemAccess));
trainerProgramRouter.get("/items/:itemType/:itemId/file/stream", asyncHandler(fileController.streamItem));
trainerProgramRouter.get("/lessons/:lessonId/attachments", asyncHandler(fileController.listLessonAttachments));
trainerProgramRouter.post(
  "/lessons/:lessonId/attachments",
  attachmentUpload.single("file"),
  asyncHandler(fileController.addLessonAttachment),
);
trainerProgramRouter.post(
  "/assignments/:assignmentId/attachments",
  attachmentUpload.single("file"),
  asyncHandler(fileController.addAssignmentAttachment),
);
trainerProgramRouter.get("/attachments/:attachmentId/file", asyncHandler(fileController.attachmentAccess));
trainerProgramRouter.get("/attachments/:attachmentId/file/stream", asyncHandler(fileController.streamAttachment));
trainerProgramRouter.delete("/attachments/:attachmentId", asyncHandler(fileController.removeAttachment));

trainerProgramRouter.post("/days/:dayId/assignments", validateBody(assignmentSchema), asyncHandler(curriculumController.addAssignment));
trainerProgramRouter.patch("/assignments/:assignmentId", validateBody(assignmentSchema.partial()), asyncHandler(curriculumController.updateAssignment));
trainerProgramRouter.delete("/assignments/:assignmentId", asyncHandler(curriculumController.deleteAssignment));

trainerProgramRouter.post("/days/:dayId/practice-quiz", validateBody(quizSchema), asyncHandler(curriculumController.addPracticeQuiz));
trainerProgramRouter.post("/weeks/:weekId/weekly-quiz", validateBody(quizSchema), asyncHandler(curriculumController.addWeeklyQuiz));
trainerProgramRouter.post("/weeks/:weekId/weekly-exam", validateBody(quizSchema), asyncHandler(curriculumController.addWeeklyExam));
trainerProgramRouter.post("/programs/:programId/final-exam", validateBody(quizSchema), asyncHandler(curriculumController.addFinalExam));
trainerProgramRouter.post("/milestones/:milestoneId/exam", validateBody(quizSchema), asyncHandler(curriculumController.addMilestoneExam));
trainerProgramRouter.patch("/quizzes/:quizId", validateBody(quizSchema), asyncHandler(curriculumController.updateQuiz));
trainerProgramRouter.delete("/quizzes/:quizId", asyncHandler(curriculumController.deleteQuiz));

trainerProgramRouter.post("/programs/:programId/milestones", validateBody(milestoneSchema), asyncHandler(curriculumController.addMilestone));
trainerProgramRouter.patch("/milestones/:milestoneId", validateBody(milestoneSchema.partial()), asyncHandler(curriculumController.updateMilestone));
trainerProgramRouter.delete("/milestones/:milestoneId", asyncHandler(curriculumController.deleteMilestone));
trainerProgramRouter.post("/milestones/:milestoneId/requirements", validateBody(requirementSchema), asyncHandler(curriculumController.addRequirement));
trainerProgramRouter.delete("/requirements/:requirementId", asyncHandler(curriculumController.deleteRequirement));

trainerProgramRouter.post("/weeks/:weekId/sessions", validateBody(sessionSchema), asyncHandler(curriculumController.addSession));
trainerProgramRouter.patch("/sessions/:sessionId", validateBody(updateSessionSchema), asyncHandler(curriculumController.updateSession));
trainerProgramRouter.delete("/sessions/:sessionId", asyncHandler(curriculumController.deleteSession));
