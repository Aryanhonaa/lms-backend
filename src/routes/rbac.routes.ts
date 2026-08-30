import { Router } from "express";
import multer from "multer";
import { assessmentController } from "../controllers/assessment.controller";
import { assignmentController } from "../controllers/assignment.controller";
import { attendanceController } from "../controllers/attendance.controller";
import { calendarController } from "../controllers/calendar.controller";
import { adminController, trainerController, traineeController } from "../controllers/rbac.controller";
import { interventionController } from "../controllers/intervention.controller";
import { learningController } from "../controllers/learning.controller";
import { progressController } from "../controllers/progress.controller";
import { programController } from "../controllers/program.controller";
import { uploadController } from "../controllers/upload.controller";
import { fileController } from "../controllers/file.controller";
import { env } from "../config/env";
import {
  achievementController,
  announcementController,
  feedbackController,
  leaderboardController,
} from "../controllers/engagement.controller";
import { certificateController } from "../controllers/certificate.controller";
import { appUsageController } from "../controllers/app-usage.controller";
import { batchController } from "../controllers/batch.controller";
import { enrollmentController } from "../controllers/enrollment.controller";
import { requireAuth } from "../middleware/require-auth";
import { requireRole } from "../middleware/require-role";
import { validateBody } from "../middleware/validate-body";
import { asyncHandler } from "../utils/async-handler";
import {
  assignmentSubmissionSchema,
  reviewSubmissionSchema,
  submitAttemptSchema,
} from "../validators/assessment.validators";
import { markAttendanceSchema, updateAttendanceSchema } from "../validators/attendance.validators";
import {
  assignRequirementSchema,
  interventionSettingsSchema,
  updateInterventionSchema,
} from "../validators/intervention.validators";
import {
  createAnnouncementSchema,
  moderateFeedbackSchema,
  submitFeedbackSchema,
} from "../validators/engagement.validators";
import { createUserSchema, updateUserSchema } from "../validators/user.validators";
import { revokeCertificateSchema } from "../validators/certificate.validators";
import { usageHeartbeatSchema } from "../validators/app-usage.validators";
import { trainerProgramRouter } from "./program.routes";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("SUPER_ADMIN", "ADMIN"));
adminRouter.get("/users", requireRole("SUPER_ADMIN"), asyncHandler(adminController.listUsers));
adminRouter.post(
  "/users",
  requireRole("SUPER_ADMIN", "ADMIN"),
  validateBody(createUserSchema),
  asyncHandler(adminController.createUser),
);
adminRouter.patch(
  "/users/:userId",
  requireRole("SUPER_ADMIN", "ADMIN"),
  validateBody(updateUserSchema),
  asyncHandler(adminController.updateUser),
);
adminRouter.delete("/users/:userId", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(adminController.deleteUser));
adminRouter.get("/dashboard", requireRole("SUPER_ADMIN"), asyncHandler(adminController.getDashboard));
adminRouter.get("/operations", asyncHandler(adminController.getOperations));
adminRouter.get("/trainers", asyncHandler(adminController.listTrainers));
adminRouter.get("/trainees", asyncHandler(adminController.listTrainees));
adminRouter.get("/trainees/:userId", asyncHandler(adminController.getTrainee));
adminRouter.get("/programs", asyncHandler(programController.listForAdmin));
adminRouter.get("/programs/:programId", asyncHandler(programController.get));
adminRouter.delete("/programs/:programId", asyncHandler(programController.remove));
adminRouter.get("/items/:itemType/:itemId/file", asyncHandler(fileController.adminItemAccess));
adminRouter.get("/items/:itemType/:itemId/file/stream", asyncHandler(fileController.streamItem));
adminRouter.get("/attachments/:attachmentId/file", asyncHandler(fileController.attachmentAccess));
adminRouter.get("/attachments/:attachmentId/file/stream", asyncHandler(fileController.streamAttachment));
adminRouter.get("/interventions", asyncHandler(interventionController.listFlags));
adminRouter.get("/requirements", asyncHandler(interventionController.listRequirements));
adminRouter.get("/requirements/:id", asyncHandler(interventionController.getRequirement));
adminRouter.get("/calendar", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(calendarController.list));
adminRouter.get("/leaderboard", requireRole("SUPER_ADMIN"), asyncHandler(leaderboardController.admin));
adminRouter.get("/feedback", requireRole("SUPER_ADMIN"), asyncHandler(feedbackController.listAdmin));
adminRouter.get("/feedback/:id", requireRole("SUPER_ADMIN"), asyncHandler(feedbackController.get));
adminRouter.patch(
  "/feedback/:id",
  requireRole("SUPER_ADMIN"),
  validateBody(moderateFeedbackSchema),
  asyncHandler(feedbackController.moderate),
);
adminRouter.get("/announcements", requireRole("SUPER_ADMIN"), asyncHandler(announcementController.list));
adminRouter.post(
  "/announcements",
  requireRole("SUPER_ADMIN"),
  validateBody(createAnnouncementSchema),
  asyncHandler(announcementController.create),
);
adminRouter.get("/programs/:programId/batches", asyncHandler(batchController.list));
adminRouter.get("/batches/:batchId/trainees", asyncHandler(batchController.listTrainees));
adminRouter.get("/certificates", requireRole("SUPER_ADMIN"), asyncHandler(certificateController.listAdmin));
adminRouter.patch(
  "/certificates/:certificateId",
  requireRole("SUPER_ADMIN"),
  validateBody(revokeCertificateSchema),
  asyncHandler(certificateController.revoke),
);
adminRouter.get("/analytics/app-usage", asyncHandler(appUsageController.analytics));

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxVideoUploadMb * 1024 * 1024 },
});
const submissionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

export const trainerRouter = Router();
trainerRouter.use(requireAuth, requireRole("TRAINER"));
trainerRouter.get("/dashboard", asyncHandler(trainerController.getDashboard));
trainerRouter.get("/search", asyncHandler(trainerController.search));
trainerRouter.get("/analytics/app-usage", asyncHandler(appUsageController.analytics));
trainerRouter.post("/uploads/video", videoUpload.single("file"), asyncHandler(uploadController.video));
trainerRouter.get("/assessments", asyncHandler(assessmentController.listForTrainer));
trainerRouter.get("/assessments/:id", asyncHandler(assessmentController.getForTrainer));
trainerRouter.get("/assignments", asyncHandler(assignmentController.listForTrainer));
trainerRouter.get("/assignments/:id", asyncHandler(assignmentController.getForTrainer));
trainerRouter.get(
  "/submissions/:id/files/:fileId",
  asyncHandler(assignmentController.downloadFile),
);
trainerRouter.get(
  "/submissions/:id/files/:fileId/access",
  asyncHandler(assignmentController.fileAccess),
);
trainerRouter.post(
  "/submissions/:id/review",
  validateBody(reviewSubmissionSchema),
  asyncHandler(assignmentController.review),
);
trainerRouter.get("/interventions", asyncHandler(interventionController.listFlags));
trainerRouter.patch(
  "/interventions/:id",
  validateBody(updateInterventionSchema),
  asyncHandler(interventionController.updateFlag),
);
trainerRouter.get("/enrollments", asyncHandler(interventionController.listEnrollments));
trainerRouter.get("/enrollments/:enrollmentId/progress", asyncHandler(enrollmentController.getEnrollmentProgress));
trainerRouter.get("/requirements", asyncHandler(interventionController.listRequirements));
trainerRouter.get("/requirements/:id", asyncHandler(interventionController.getRequirement));
trainerRouter.post(
  "/requirements",
  validateBody(assignRequirementSchema),
  asyncHandler(interventionController.assign),
);
trainerRouter.patch(
  "/programs/:programId/intervention-settings",
  validateBody(interventionSettingsSchema),
  asyncHandler(interventionController.updateSettings),
);
trainerRouter.get("/calendar", asyncHandler(calendarController.list));
trainerRouter.get("/leaderboard", asyncHandler(leaderboardController.trainer));
trainerRouter.get("/feedback", asyncHandler(feedbackController.listTrainer));
trainerRouter.get("/feedback/:id", asyncHandler(feedbackController.get));
trainerRouter.get("/announcements", asyncHandler(announcementController.list));
trainerRouter.get("/notifications", asyncHandler(announcementController.inbox));
trainerRouter.post("/notifications/read", asyncHandler(announcementController.markRead));
trainerRouter.post(
  "/announcements",
  validateBody(createAnnouncementSchema),
  asyncHandler(announcementController.create),
);
trainerRouter.get("/certificates", asyncHandler(certificateController.listTrainer));
trainerRouter.get("/programs/:programId/attendance", asyncHandler(attendanceController.listProgram));
trainerRouter.put(
  "/sessions/:sessionId/attendance",
  validateBody(markAttendanceSchema),
  asyncHandler(attendanceController.mark),
);
trainerRouter.patch(
  "/attendance/:id",
  validateBody(updateAttendanceSchema),
  asyncHandler(attendanceController.update),
);
trainerRouter.use(trainerProgramRouter);

export const traineeRouter = Router();
traineeRouter.use(requireAuth, requireRole("TRAINEE"));
traineeRouter.get("/dashboard", asyncHandler(traineeController.getDashboard));
traineeRouter.get("/search", asyncHandler(traineeController.search));
traineeRouter.get("/usage/config", asyncHandler(appUsageController.config));
traineeRouter.post("/usage/heartbeat", validateBody(usageHeartbeatSchema), asyncHandler(appUsageController.heartbeat));
traineeRouter.post("/usage/end", asyncHandler(appUsageController.end));
traineeRouter.get("/enrollments", asyncHandler(learningController.listEnrollments));
traineeRouter.get("/progress", asyncHandler(progressController.list));
traineeRouter.get("/programs/:programId/progress", asyncHandler(progressController.getProgram));
traineeRouter.get("/programs/:programId", asyncHandler(learningController.getProgram));
traineeRouter.get("/programs/:programId/learn", asyncHandler(learningController.getLearn));
traineeRouter.get("/items/:itemType/:itemId", asyncHandler(learningController.getItem));
traineeRouter.post("/items/:itemType/:itemId/complete", asyncHandler(learningController.completeItem));
traineeRouter.get("/assessments", asyncHandler(assessmentController.listForTrainee));
traineeRouter.get("/assessments/:id", asyncHandler(assessmentController.getForTrainee));
traineeRouter.post("/assessments/:id/attempts", asyncHandler(assessmentController.startAttempt));
traineeRouter.get("/attempts/:id", asyncHandler(assessmentController.getAttempt));
traineeRouter.post(
  "/attempts/:id/submit",
  validateBody(submitAttemptSchema),
  asyncHandler(assessmentController.submitAttempt),
);
traineeRouter.get("/assignments", asyncHandler(assignmentController.listForTrainee));
traineeRouter.get("/assignments/:id", asyncHandler(assignmentController.getForTrainee));
traineeRouter.post(
  "/assignments/:id/submissions",
  validateBody(assignmentSubmissionSchema),
  asyncHandler(assignmentController.submit),
);
traineeRouter.post(
  "/submissions/:id/files",
  submissionUpload.single("file"),
  asyncHandler(assignmentController.addFile),
);
traineeRouter.delete("/submissions/:id/files/:fileId", asyncHandler(assignmentController.removeFile));
traineeRouter.get("/submissions/:id/files/:fileId", asyncHandler(assignmentController.downloadFile));
traineeRouter.get("/submissions/:id/files/:fileId/access", asyncHandler(assignmentController.fileAccess));
// Authorized access to learning files stored in Cloudflare R2.
traineeRouter.get("/items/:itemType/:itemId/file", asyncHandler(fileController.traineeItemAccess));
traineeRouter.get("/items/:itemType/:itemId/file/stream", asyncHandler(fileController.streamItem));
traineeRouter.get("/attachments/:attachmentId/file", asyncHandler(fileController.attachmentAccess));
traineeRouter.get("/attachments/:attachmentId/file/stream", asyncHandler(fileController.streamAttachment));
traineeRouter.get("/requirements", asyncHandler(interventionController.listRequirements));
traineeRouter.get("/requirements/:id", asyncHandler(interventionController.getRequirement));
traineeRouter.post("/requirements/:id/start", asyncHandler(interventionController.startRequirement));
traineeRouter.post("/requirements/:id/complete", asyncHandler(interventionController.completeRequirement));
traineeRouter.get("/attendance", asyncHandler(attendanceController.listMine));
traineeRouter.get("/attendance/:id", asyncHandler(attendanceController.getRecord));
traineeRouter.get("/calendar", asyncHandler(calendarController.list));
traineeRouter.get("/leaderboard", asyncHandler(leaderboardController.trainee));
traineeRouter.get("/achievements", asyncHandler(achievementController.listMine));
traineeRouter.get("/feedback/options", asyncHandler(feedbackController.options));
traineeRouter.get("/feedback", asyncHandler(feedbackController.listMine));
traineeRouter.post("/feedback", validateBody(submitFeedbackSchema), asyncHandler(feedbackController.submit));
traineeRouter.get("/feedback/:id", asyncHandler(feedbackController.get));
traineeRouter.get("/announcements", asyncHandler(announcementController.list));
traineeRouter.get("/notifications", asyncHandler(announcementController.inbox));
traineeRouter.post("/notifications/read", asyncHandler(announcementController.markRead));
traineeRouter.get("/certificates", asyncHandler(certificateController.listMine));
traineeRouter.get("/certificates/:certificateId", asyncHandler(certificateController.getMine));
traineeRouter.get("/programs/:programId/certificate", asyncHandler(certificateController.status));
