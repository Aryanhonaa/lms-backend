import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { env } from "./config/env";
import { isAllowedCorsOrigin } from "./utils/cors-origin";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { servePublicUpload } from "./middleware/serve-public-uploads";
import { asyncHandler } from "./utils/async-handler";
// import { apiRateLimiter } from "./middleware/rate-limit";
import { apiRouter } from "./routes";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (isAllowedCorsOrigin(origin, env.corsOrigin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
  app.use("/uploads", asyncHandler(servePublicUpload));
  app.use("/api/v1", /* apiRateLimiter, */ apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
