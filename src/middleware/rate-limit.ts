import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { ApiError } from "../utils/api-error";

const passthrough: RequestHandler = (_req, _res, next) => {
  next();
};

export const apiRateLimiter: RequestHandler = env.isTest
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        next(ApiError.tooManyRequests());
      },
    });

export const loginRateLimiter: RequestHandler = env.isTest
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        next(ApiError.tooManyRequests("Too many login attempts"));
      },
    });

export const verifyRateLimiter: RequestHandler = env.isTest
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        next(ApiError.tooManyRequests("Too many verification attempts"));
      },
    });
