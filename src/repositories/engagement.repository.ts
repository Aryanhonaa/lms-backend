import { randomUUID } from "node:crypto";
import { AchievementKey, type FeedbackModerationStatus } from "../generated/prisma";
import { prisma } from "../config/prisma";

const catalog: Array<{ key: AchievementKey; title: string; description: string }> = [
  {
    key: AchievementKey.FIRST_COURSE_COMPLETED,
    title: "First Course Completed",
    description: "Finish a program by reaching 100% weighted progress.",
  },
  {
    key: AchievementKey.PERFECT_QUIZ,
    title: "Perfect Quiz",
    description: "Score 100 on a closed practice or weekly quiz.",
  },
  {
    key: AchievementKey.MILESTONE_MASTER,
    title: "Milestone Master",
    description: "Satisfy every milestone on a program you are enrolled in.",
  },
  {
    key: AchievementKey.TOP_PERFORMER,
    title: "Top Performer",
    description: "Rank first on a program leaderboard with at least two trainees.",
  },
  {
    key: AchievementKey.PERFECT_ATTENDANCE,
    title: "100% Attendance",
    description: "Hold 100% attendance with at least one countable session mark.",
  },
  {
    key: AchievementKey.LEARNING_STREAK,
    title: "Learning Streak",
    description: "Complete learning content on three distinct UTC calendar days.",
  },
  {
    key: AchievementKey.EXAM_CHAMPION,
    title: "Exam Champion",
    description: "Pass a weekly, milestone, or final exam.",
  },
];

export const achievementRepository = {
  async ensureCatalog() {
    for (const item of catalog) {
      await prisma.achievement.upsert({
        where: { key: item.key },
        update: { title: item.title, description: item.description },
        create: item,
      });
    }
    return prisma.achievement.findMany({ orderBy: { title: "asc" } });
  },

  findByKey(key: AchievementKey) {
    return prisma.achievement.findUnique({ where: { key } });
  },

  listAwards(userId: string) {
    return prisma.traineeAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { earnedAt: "desc" },
    });
  },

  async grant(userId: string, key: AchievementKey, enrollmentId?: string | null) {
    const achievement = await prisma.achievement.findUnique({ where: { key } });
    if (!achievement) {
      return null;
    }

    return prisma.traineeAchievement.upsert({
      where: {
        userId_achievementId: { userId, achievementId: achievement.id },
      },
      create: {
        userId,
        achievementId: achievement.id,
        enrollmentId: enrollmentId ?? null,
      },
      update: {},
    });
  },
};

export const feedbackRepository = {
  findCourseReview(enrollmentId: string) {
    return prisma.feedback.findFirst({
      where: { enrollmentId, targetKind: "COURSE" },
      include: {
        author: { select: { id: true, name: true } },
        program: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  create(data: {
    authorUserId: string;
    targetKind: "COURSE" | "TRAINER" | "SESSION" | "MATERIAL";
    targetId: string;
    programId?: string | null;
    enrollmentId?: string | null;
    rating: number;
    comment: string;
  }) {
    return prisma.feedback.create({
      data: {
        authorUserId: data.authorUserId,
        targetKind: data.targetKind,
        targetId: data.targetId,
        programId: data.programId ?? null,
        enrollmentId: data.enrollmentId ?? null,
        rating: data.rating,
        comment: data.comment,
      },
      include: {
        author: { select: { id: true, name: true } },
        program: { select: { id: true, title: true } },
      },
    });
  },

  findById(id: string) {
    return prisma.feedback.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        program: { select: { id: true, title: true } },
      },
    });
  },

  listForAuthor(authorUserId: string) {
    return prisma.feedback.findMany({
      where: { authorUserId },
      include: {
        author: { select: { id: true, name: true } },
        program: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  listForPrograms(programIds: string[], status?: FeedbackModerationStatus) {
    if (programIds.length === 0) {
      return Promise.resolve([]);
    }

    return prisma.feedback.findMany({
      where: {
        programId: { in: programIds },
        ...(status ? { status } : {}),
      },
      include: {
        author: { select: { id: true, name: true } },
        program: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  listAll(status?: FeedbackModerationStatus) {
    return prisma.feedback.findMany({
      where: status ? { status } : undefined,
      include: {
        author: { select: { id: true, name: true } },
        program: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  moderate(id: string, status: FeedbackModerationStatus, moderatedByUserId: string) {
    return prisma.feedback.update({
      where: { id },
      data: { status, moderatedByUserId, moderatedAt: new Date() },
      include: {
        author: { select: { id: true, name: true } },
        program: { select: { id: true, title: true } },
      },
    });
  },
};

const announcementInclude = {
  createdBy: { select: { id: true, name: true } },
  program: { select: { id: true, title: true } },
  batch: { select: { id: true, name: true } },
  recipients: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" as const } },
  },
};

export const announcementRepository = {
  create(data: {
    title: string;
    body: string;
    audience: "EVERYONE" | "TRAINERS" | "TRAINEES" | "PROGRAM" | "TRAINEES_SELECTED";
    programId?: string | null;
    batchId?: string | null;
    createdByUserId: string;
    traineeIds?: string[];
  }) {
    return prisma.announcement.create({
      data: {
        title: data.title,
        body: data.body,
        audience: data.audience,
        programId: data.programId ?? null,
        batchId: data.batchId ?? null,
        createdByUserId: data.createdByUserId,
        recipients: data.traineeIds?.length
          ? { create: data.traineeIds.map((userId) => ({ userId })) }
          : undefined,
      },
      include: announcementInclude,
    });
  },

  listRecent(take = 50) {
    return prisma.announcement.findMany({
      include: announcementInclude,
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  listReadIds(userId: string, announcementIds: string[]) {
    if (announcementIds.length === 0) {
      return Promise.resolve([] as Array<{ announcementId: string }>);
    }
    return prisma.announcementRead.findMany({
      where: { userId, announcementId: { in: announcementIds } },
      select: { announcementId: true },
    });
  },

  markRead(userId: string, announcementIds: string[]) {
    if (announcementIds.length === 0) {
      return Promise.resolve({ count: 0 });
    }
    return prisma.announcementRead.createMany({
      data: announcementIds.map((announcementId) => ({ id: randomUUID(), announcementId, userId })),
      skipDuplicates: true,
    });
  },
};
