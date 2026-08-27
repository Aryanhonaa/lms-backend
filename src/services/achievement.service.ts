import {
  AchievementKey,
  EnrollmentStatus,
  QuizKind,
} from "../generated/prisma";
import { prisma } from "../config/prisma";
import { achievementRepository } from "../repositories/engagement.repository";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programRepository } from "../repositories/program.repository";
import { quizState, type ProgramTree } from "./unlock.service";
import { attendancePercentage } from "../utils/attendance-math";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";

const QUIZ_KINDS: QuizKind[] = [QuizKind.PRACTICE_QUIZ, QuizKind.WEEKLY_QUIZ];
const EXAM_KINDS: QuizKind[] = [QuizKind.WEEKLY_EXAM, QuizKind.MILESTONE_EXAM, QuizKind.FINAL_EXAM];

function collectQuizzes(program: ProgramTree) {
  const rows = [
    ...program.quizzes,
    ...program.weeks.flatMap((week) => week.quizzes),
    ...program.weeks.flatMap((week) => week.days.flatMap((day) => day.quizzes)),
    ...program.milestones.flatMap((milestone) => (milestone.exam ? [milestone.exam] : [])),
  ];
  const seen = new Set<string>();
  return rows.filter((quiz) => {
    if (seen.has(quiz.id)) {
      return false;
    }
    seen.add(quiz.id);
    return true;
  });
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export const achievementService = {
  async evaluateEnrollment(enrollmentId: string) {
    await achievementRepository.ensureCatalog();
    const enrollment = await enrollmentRepository.findFactsById(enrollmentId);
    if (!enrollment) {
      return;
    }
    const program = await programRepository.findTreeById(enrollment.programId);
    if (!program) {
      return;
    }

    const { progressService } = await import("./progress.service");
    const facts = progressService.factsFromEnrollment(enrollment);
    const view = progressService.compute(program, enrollment.id, facts);
    const userId = enrollment.userId;
    const quizzes = collectQuizzes(program);

    if (view.progress.percent >= 100 || enrollment.status === EnrollmentStatus.COMPLETED) {
      await achievementRepository.grant(userId, AchievementKey.FIRST_COURSE_COMPLETED, enrollment.id);
    }

    const quizItems = quizzes.filter((quiz) => QUIZ_KINDS.includes(quiz.kind));
    if (quizItems.some((quiz) => (quizState(facts, quiz.id).bestScore ?? 0) >= 100)) {
      await achievementRepository.grant(userId, AchievementKey.PERFECT_QUIZ, enrollment.id);
    }

    if (program.milestones.length > 0 && view.milestones.every((milestone) => milestone.satisfied)) {
      await achievementRepository.grant(userId, AchievementKey.MILESTONE_MASTER, enrollment.id);
    }

    const attendancePercent = attendancePercentage(enrollment.attendances.map((row) => row.status));
    if (attendancePercent === 100) {
      await achievementRepository.grant(userId, AchievementKey.PERFECT_ATTENDANCE, enrollment.id);
    }

    const streakDays = new Set(enrollment.completions.map((row) => utcDay(row.completedAt)));
    if (streakDays.size >= 3) {
      await achievementRepository.grant(userId, AchievementKey.LEARNING_STREAK, enrollment.id);
    }

    const examItems = quizzes.filter((quiz) => EXAM_KINDS.includes(quiz.kind));
    if (examItems.some((quiz) => quizState(facts, quiz.id).passed)) {
      await achievementRepository.grant(userId, AchievementKey.EXAM_CHAMPION, enrollment.id);
    }
  },

  async listForTrainee(user: AuthUser) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }

    const enrollments = await enrollmentRepository.findByUser(user.id);
    for (const enrollment of enrollments) {
      await this.evaluateEnrollment(enrollment.id);
    }

    const catalog = await achievementRepository.ensureCatalog();
    const awards = await achievementRepository.listAwards(user.id);
    const earnedByKey = new Map(awards.map((row) => [row.achievement.key, row]));

    return {
      achievements: catalog.map((item) => {
        const earned = earnedByKey.get(item.key);
        return {
          id: item.id,
          key: item.key,
          title: item.title,
          description: item.description,
          earned: Boolean(earned),
          earnedAt: earned?.earnedAt ?? null,
        };
      }),
    };
  },

  async listForOperator(user: AuthUser, traineeUserId: string) {
    if (user.role === "TRAINEE") {
      throw ApiError.forbidden();
    }
    if (user.role === "TRAINER") {
      const overlap = await prisma.enrollment.findFirst({
        where: {
          userId: traineeUserId,
          program: { trainers: { some: { userId: user.id } } },
        },
      });
      if (!overlap) {
        throw ApiError.notFound("Trainee not found");
      }
    }

    const catalog = await achievementRepository.ensureCatalog();
    const awards = await achievementRepository.listAwards(traineeUserId);
    const earnedByKey = new Map(awards.map((row) => [row.achievement.key, row]));
    const trainee = await prisma.user.findUnique({
      where: { id: traineeUserId },
      select: { id: true, name: true },
    });
    if (!trainee) {
      throw ApiError.notFound("Trainee not found");
    }

    return {
      trainee,
      achievements: catalog.map((item) => {
        const earned = earnedByKey.get(item.key);
        return {
          id: item.id,
          key: item.key,
          title: item.title,
          description: item.description,
          earned: Boolean(earned),
          earnedAt: earned?.earnedAt ?? null,
        };
      }),
    };
  },
};
