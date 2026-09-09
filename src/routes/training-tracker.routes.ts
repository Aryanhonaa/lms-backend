import { Router } from "express";
import { trainingTrackerController } from "../controllers/training-tracker.controller";
import { requireAuth } from "../middleware/require-auth";
import { requireRole } from "../middleware/require-role";
import { validateBody } from "../middleware/validate-body";
import { asyncHandler } from "../utils/async-handler";
import {
  addNhtTraineeSchema,
  addStandaloneTraineeSchema,
  attritionSchema,
  createNhtBatchSchema,
  examResultSchema,
  handoverSchema,
  lcaAuditSchema,
  tniDecisionSchema,
  tniSupportSchema,
  updateNhtBatchSchema,
} from "../validators/training-tracker.validators";

export const trainingTrackerRouter = Router();
trainingTrackerRouter.use(requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "TRAINER"));
trainingTrackerRouter.get("/options", asyncHandler(trainingTrackerController.options));
trainingTrackerRouter.get("/dashboard", asyncHandler(trainingTrackerController.dashboard));
trainingTrackerRouter.get("/batches", asyncHandler(trainingTrackerController.listBatches));
trainingTrackerRouter.post("/batches", validateBody(createNhtBatchSchema), asyncHandler(trainingTrackerController.createBatch));
trainingTrackerRouter.get("/batches/:batchId", asyncHandler(trainingTrackerController.getBatch));
trainingTrackerRouter.patch("/batches/:batchId", validateBody(updateNhtBatchSchema), asyncHandler(trainingTrackerController.updateBatch));
trainingTrackerRouter.post("/batches/:batchId/trainees", validateBody(addNhtTraineeSchema), asyncHandler(trainingTrackerController.addTrainee));
trainingTrackerRouter.get("/trainees", asyncHandler(trainingTrackerController.listTrainees));
trainingTrackerRouter.post("/trainees", validateBody(addStandaloneTraineeSchema), asyncHandler(trainingTrackerController.addStandalone));
trainingTrackerRouter.post("/trainees/:traineeId/attrition", validateBody(attritionSchema), asyncHandler(trainingTrackerController.recordAttrition));
trainingTrackerRouter.post("/trainees/:traineeId/exam", validateBody(examResultSchema), asyncHandler(trainingTrackerController.recordExam));
trainingTrackerRouter.post("/trainees/:traineeId/handover", validateBody(handoverSchema), asyncHandler(trainingTrackerController.recordHandover));
trainingTrackerRouter.get("/audits", asyncHandler(trainingTrackerController.listAudits));
trainingTrackerRouter.post("/audits", validateBody(lcaAuditSchema), asyncHandler(trainingTrackerController.createAudit));
trainingTrackerRouter.get("/tni", asyncHandler(trainingTrackerController.listTni));
trainingTrackerRouter.patch("/tni/:tniId/support", validateBody(tniSupportSchema), asyncHandler(trainingTrackerController.updateTniSupport));
trainingTrackerRouter.post("/tni/:tniId/decision", validateBody(tniDecisionSchema), asyncHandler(trainingTrackerController.decideTni));
