import type { Request, Response } from "express";
import { curriculumService } from "../services/curriculum.service";
import { sendSuccess } from "../utils/api-response";
import { routeParam } from "../utils/route-param";

function sendProgram(res: Response, program: unknown) {
  sendSuccess(res, { program });
}

export const curriculumController = {
  async addWeek(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addWeek(req.user!, routeParam(req, "programId"), req.body));
  },
  async updateWeek(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateWeek(req.user!, routeParam(req, "weekId"), req.body));
  },
  async deleteWeek(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteWeek(req.user!, routeParam(req, "weekId")));
  },
  async addDay(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addDay(req.user!, routeParam(req, "weekId"), req.body));
  },
  async updateDay(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateDay(req.user!, routeParam(req, "dayId"), req.body));
  },
  async deleteDay(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteDay(req.user!, routeParam(req, "dayId")));
  },
  async addLesson(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addLesson(req.user!, routeParam(req, "dayId"), req.body));
  },
  async updateLesson(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateLesson(req.user!, routeParam(req, "lessonId"), req.body));
  },
  async deleteLesson(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteLesson(req.user!, routeParam(req, "lessonId")));
  },
  async addVideo(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addVideo(req.user!, routeParam(req, "dayId"), req.body));
  },
  async updateVideo(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateVideo(req.user!, routeParam(req, "videoId"), req.body));
  },
  async deleteVideo(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteVideo(req.user!, routeParam(req, "videoId")));
  },
  async addResource(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addResource(req.user!, routeParam(req, "dayId"), req.body));
  },
  async updateResource(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateResource(req.user!, routeParam(req, "resourceId"), req.body));
  },
  async deleteResource(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteResource(req.user!, routeParam(req, "resourceId")));
  },
  async addReel(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addReel(req.user!, routeParam(req, "dayId"), req.body));
  },
  async updateReel(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateReel(req.user!, routeParam(req, "reelId"), req.body));
  },
  async deleteReel(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteReel(req.user!, routeParam(req, "reelId")));
  },
  async addAssignment(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addAssignment(req.user!, routeParam(req, "dayId"), req.body));
  },
  async updateAssignment(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateAssignment(req.user!, routeParam(req, "assignmentId"), req.body));
  },
  async deleteAssignment(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteAssignment(req.user!, routeParam(req, "assignmentId")));
  },
  async addPracticeQuiz(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addPracticeQuiz(req.user!, routeParam(req, "dayId"), req.body));
  },
  async addWeeklyQuiz(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addWeeklyQuiz(req.user!, routeParam(req, "weekId"), req.body));
  },
  async addWeeklyExam(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addWeeklyExam(req.user!, routeParam(req, "weekId"), req.body));
  },
  async addFinalExam(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addFinalExam(req.user!, routeParam(req, "programId"), req.body));
  },
  async addMilestoneExam(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addMilestoneExam(req.user!, routeParam(req, "milestoneId"), req.body));
  },
  async updateQuiz(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateQuiz(req.user!, routeParam(req, "quizId"), req.body));
  },
  async deleteQuiz(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteQuiz(req.user!, routeParam(req, "quizId")));
  },
  async addMilestone(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addMilestone(req.user!, routeParam(req, "programId"), req.body));
  },
  async updateMilestone(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateMilestone(req.user!, routeParam(req, "milestoneId"), req.body));
  },
  async deleteMilestone(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteMilestone(req.user!, routeParam(req, "milestoneId")));
  },
  async addRequirement(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addRequirement(req.user!, routeParam(req, "milestoneId"), req.body));
  },
  async deleteRequirement(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteRequirement(req.user!, routeParam(req, "requirementId")));
  },
  async addSession(req: Request, res: Response) {
    sendProgram(res, await curriculumService.addSession(req.user!, routeParam(req, "weekId"), req.body));
  },
  async updateSession(req: Request, res: Response) {
    sendProgram(res, await curriculumService.updateSession(req.user!, routeParam(req, "sessionId"), req.body));
  },
  async deleteSession(req: Request, res: Response) {
    sendProgram(res, await curriculumService.deleteSession(req.user!, routeParam(req, "sessionId")));
  },
};
