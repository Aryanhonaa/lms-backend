import { Router } from "express";
import { authModule } from "../modules/auth";
import { healthModule } from "../modules/health";
import { adminModule, traineeModule, trainerModule } from "../modules/rbac";
import { programWorkflowRouter } from "./program-workflow.routes";
import { verifyRouter } from "./verify.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthModule.router);
apiRouter.use("/auth", authModule.router);
apiRouter.use("/admin", adminModule.router);
apiRouter.use("/trainer", trainerModule.router);
apiRouter.use("/trainee", traineeModule.router);
apiRouter.use("/programs", programWorkflowRouter);
apiRouter.use("/verify", verifyRouter);
