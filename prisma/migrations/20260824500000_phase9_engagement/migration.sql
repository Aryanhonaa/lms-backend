-- CreateEnum
CREATE TYPE "AchievementKey" AS ENUM (
  'FIRST_COURSE_COMPLETED',
  'PERFECT_QUIZ',
  'MILESTONE_MASTER',
  'TOP_PERFORMER',
  'PERFECT_ATTENDANCE',
  'LEARNING_STREAK',
  'EXAM_CHAMPION'
);

-- CreateEnum
CREATE TYPE "FeedbackTargetKind" AS ENUM ('COURSE', 'TRAINER', 'SESSION', 'MATERIAL');

-- CreateEnum
CREATE TYPE "FeedbackModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('EVERYONE', 'TRAINERS', 'TRAINEES', 'PROGRAM');

-- CreateTable
CREATE TABLE "Achievement" (
    "id" UUID NOT NULL,
    "key" "AchievementKey" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraineeAchievement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "achievementId" UUID NOT NULL,
    "enrollmentId" UUID,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraineeAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "targetKind" "FeedbackTargetKind" NOT NULL,
    "targetId" UUID NOT NULL,
    "programId" UUID,
    "enrollmentId" UUID,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "status" "FeedbackModerationStatus" NOT NULL DEFAULT 'PENDING',
    "moderatedByUserId" UUID,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "programId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TraineeAchievement_userId_achievementId_key" ON "TraineeAchievement"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "TraineeAchievement_userId_idx" ON "TraineeAchievement"("userId");

-- CreateIndex
CREATE INDEX "TraineeAchievement_achievementId_idx" ON "TraineeAchievement"("achievementId");

-- CreateIndex
CREATE INDEX "TraineeAchievement_enrollmentId_idx" ON "TraineeAchievement"("enrollmentId");

-- CreateIndex
CREATE INDEX "Feedback_authorUserId_idx" ON "Feedback"("authorUserId");

-- CreateIndex
CREATE INDEX "Feedback_programId_status_idx" ON "Feedback"("programId", "status");

-- CreateIndex
CREATE INDEX "Feedback_targetKind_targetId_idx" ON "Feedback"("targetKind", "targetId");

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");

-- CreateIndex
CREATE INDEX "Feedback_moderatedByUserId_idx" ON "Feedback"("moderatedByUserId");

-- CreateIndex
CREATE INDEX "Announcement_audience_createdAt_idx" ON "Announcement"("audience", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_programId_idx" ON "Announcement"("programId");

-- CreateIndex
CREATE INDEX "Announcement_createdByUserId_idx" ON "Announcement"("createdByUserId");

-- AddForeignKey
ALTER TABLE "TraineeAchievement" ADD CONSTRAINT "TraineeAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraineeAchievement" ADD CONSTRAINT "TraineeAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraineeAchievement" ADD CONSTRAINT "TraineeAchievement_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_moderatedByUserId_fkey" FOREIGN KEY ("moderatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Achievement" ("id", "key", "title", "description", "createdAt", "updatedAt") VALUES
  ('a9000000-0000-4000-8000-000000000001', 'FIRST_COURSE_COMPLETED', 'First Course Completed', 'Finish a program by reaching 100% weighted progress.', NOW(), NOW()),
  ('a9000000-0000-4000-8000-000000000002', 'PERFECT_QUIZ', 'Perfect Quiz', 'Score 100 on a closed practice or weekly quiz.', NOW(), NOW()),
  ('a9000000-0000-4000-8000-000000000003', 'MILESTONE_MASTER', 'Milestone Master', 'Satisfy every milestone on a program you are enrolled in.', NOW(), NOW()),
  ('a9000000-0000-4000-8000-000000000004', 'TOP_PERFORMER', 'Top Performer', 'Rank first on a program leaderboard with at least two trainees.', NOW(), NOW()),
  ('a9000000-0000-4000-8000-000000000005', 'PERFECT_ATTENDANCE', '100% Attendance', 'Hold 100% attendance with at least one countable session mark.', NOW(), NOW()),
  ('a9000000-0000-4000-8000-000000000006', 'LEARNING_STREAK', 'Learning Streak', 'Complete learning content on three distinct UTC calendar days.', NOW(), NOW()),
  ('a9000000-0000-4000-8000-000000000007', 'EXAM_CHAMPION', 'Exam Champion', 'Pass a weekly, milestone, or final exam.', NOW(), NOW());
