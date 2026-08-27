import type { Request, Response } from "express";
import { FeedbackModerationStatus } from "../generated/prisma";
import { achievementService } from "../services/achievement.service";
import { announcementService } from "../services/announcement.service";
import { feedbackService } from "../services/feedback.service";
import { leaderboardService } from "../services/leaderboard.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function feedbackStatus(req: Request): FeedbackModerationStatus | undefined {
  const value = queryString(req, "status");
  if (!value) {
    return undefined;
  }
  if (!Object.values(FeedbackModerationStatus).includes(value as FeedbackModerationStatus)) {
    return undefined;
  }
  return value as FeedbackModerationStatus;
}

export const leaderboardController = {
  async trainee(req: Request, res: Response) {
    sendSuccess(res, await leaderboardService.forTrainee(req.user!, queryString(req, "programId"), queryString(req, "batchId")));
  },

  async trainer(req: Request, res: Response) {
    sendSuccess(res, await leaderboardService.forTrainer(req.user!, queryString(req, "programId"), queryString(req, "batchId")));
  },

  async admin(req: Request, res: Response) {
    sendSuccess(res, await leaderboardService.forAdmin(req.user!, queryString(req, "programId"), queryString(req, "batchId")));
  },
};

export const achievementController = {
  async listMine(req: Request, res: Response) {
    sendSuccess(res, await achievementService.listForTrainee(req.user!));
  },
};

export const feedbackController = {
  async options(req: Request, res: Response) {
    sendSuccess(res, await feedbackService.options(req.user!));
  },

  async submit(req: Request, res: Response) {
    sendSuccess(res, await feedbackService.submit(req.user!, req.body), 201);
  },

  async listMine(req: Request, res: Response) {
    sendSuccess(res, await feedbackService.listMine(req.user!));
  },

  async get(req: Request, res: Response) {
    sendSuccess(res, await feedbackService.getMine(req.user!, routeParam(req, "id")));
  },

  async listTrainer(req: Request, res: Response) {
    sendSuccess(
      res,
      await feedbackService.listForTrainer(req.user!, queryString(req, "programId"), feedbackStatus(req)),
    );
  },

  async listAdmin(req: Request, res: Response) {
    sendSuccess(res, await feedbackService.listForAdmin(req.user!, feedbackStatus(req)));
  },

  async moderate(req: Request, res: Response) {
    sendSuccess(res, await feedbackService.moderate(req.user!, routeParam(req, "id"), req.body.status));
  },
};

export const announcementController = {
  async list(req: Request, res: Response) {
    sendSuccess(res, await announcementService.listForUser(req.user!));
  },

  async inbox(req: Request, res: Response) {
    sendSuccess(res, await announcementService.inbox(req.user!));
  },

  async markRead(req: Request, res: Response) {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((id): id is string => typeof id === "string") : undefined;
    sendSuccess(res, await announcementService.markRead(req.user!, ids));
  },

  async create(req: Request, res: Response) {
    sendSuccess(res, await announcementService.create(req.user!, req.body), 201);
  },
};
