import type { Request, Response } from "express";
import { adminDashboardService } from "../services/admin-dashboard.service";
import { adminPeopleService } from "../services/admin-people.service";
import { adminService, traineeService, trainerService } from "../services/rbac.service";
import { trainerDashboardService } from "../services/trainer-dashboard.service";
import { traineeDashboardService } from "../services/trainee-dashboard.service";
import { userService } from "../services/user.service";
import type { CreateUserInput } from "../validators/user.validators";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

export const adminController = {
  async listUsers(_req: Request, res: Response): Promise<void> {
    const users = await adminService.listUsers();
    sendSuccess(res, { users });
  },

  async createUser(req: Request, res: Response): Promise<void> {
    const user = await userService.createAccount(req.user!, req.body as CreateUserInput);
    sendSuccess(res, { user }, 201);
  },

  async deleteUser(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await userService.deleteAccount(req.user!, routeParam(req, "userId")));
  },

  async getDashboard(_req: Request, res: Response): Promise<void> {
    const dashboard = await adminDashboardService.getOverview();
    sendSuccess(res, { dashboard });
  },

  async getOperations(_req: Request, res: Response): Promise<void> {
    const dashboard = await adminDashboardService.getOperations();
    sendSuccess(res, { dashboard });
  },

  async listTrainers(req: Request, res: Response): Promise<void> {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    sendSuccess(res, await adminPeopleService.listTrainers(req.user!, query));
  },

  async listTrainees(req: Request, res: Response): Promise<void> {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    sendSuccess(res, await adminPeopleService.listTrainees(req.user!, query));
  },

  async getTrainee(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await adminPeopleService.getTrainee(req.user!, routeParam(req, "userId")));
  },
};

export const trainerController = {
  async listPrograms(req: Request, res: Response): Promise<void> {
    const programs = await trainerService.listPrograms(req.user!.id);
    sendSuccess(res, { programs });
  },

  async getDashboard(req: Request, res: Response): Promise<void> {
    const dashboard = await trainerDashboardService.getOverview(req.user!, req.query.range);
    sendSuccess(res, { dashboard });
  },

  async search(req: Request, res: Response): Promise<void> {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    sendSuccess(res, await trainerDashboardService.search(req.user!, query));
  },
};

export const traineeController = {
  async listEnrollments(req: Request, res: Response): Promise<void> {
    const enrollments = await traineeService.listEnrollments(req.user!.id);
    sendSuccess(res, { enrollments });
  },

  async getDashboard(req: Request, res: Response): Promise<void> {
    const dashboard = await traineeDashboardService.getOverview(req.user!, req.query.range);
    sendSuccess(res, { dashboard });
  },

  async search(req: Request, res: Response): Promise<void> {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    sendSuccess(res, await traineeDashboardService.search(req.user!, query));
  },
};
