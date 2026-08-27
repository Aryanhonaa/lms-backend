import { Router } from "express";
import { certificateController } from "../controllers/certificate.controller";
import { verifyRateLimiter } from "../middleware/rate-limit";
import { asyncHandler } from "../utils/async-handler";

export const verifyRouter = Router();

verifyRouter.use(verifyRateLimiter);
verifyRouter.get("/:certificateId", asyncHandler(certificateController.verify));
verifyRouter.get("/", asyncHandler(certificateController.verify));
