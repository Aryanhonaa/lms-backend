-- AlterTable
ALTER TABLE "Program" ADD COLUMN "createdByUserId" UUID;
ALTER TABLE "Program" ADD COLUMN "rejectedByUserId" UUID;
ALTER TABLE "Program" ADD COLUMN "rejectedAt" TIMESTAMP(3);

UPDATE "Program" AS p
SET "createdByUserId" = (
  SELECT pt."userId"
  FROM "ProgramTrainer" pt
  WHERE pt."programId" = p."id" AND pt."role" = 'OWNER'
  LIMIT 1
);

DELETE FROM "Program" WHERE "createdByUserId" IS NULL;

ALTER TABLE "Program" ALTER COLUMN "createdByUserId" SET NOT NULL;

CREATE INDEX "Program_createdByUserId_idx" ON "Program"("createdByUserId");

ALTER TABLE "Program" ADD CONSTRAINT "Program_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Program" ADD CONSTRAINT "Program_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('YOUTUBE', 'UPLOADED', 'EXTERNAL');
CREATE TYPE "ResourceKind" AS ENUM ('DOCUMENT', 'ARTICLE', 'GITHUB', 'YOUTUBE', 'WEBSITE', 'TUTORIAL');
CREATE TYPE "QuizKind" AS ENUM ('PRACTICE', 'WEEKLY_QUIZ', 'WEEKLY_EXAM', 'MILESTONE_EXAM', 'FINAL_EXAM');

-- CreateTable
CREATE TABLE "Week" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "objectives" TEXT[],
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Week_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Day" (
    "id" UUID NOT NULL,
    "weekId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Day_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lesson" (
    "id" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "durationMin" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Video" (
    "id" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "source" "VideoSource" NOT NULL,
    "url" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Resource" (
    "id" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reel" (
    "id" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Assignment" (
    "id" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dueDate" TIMESTAMP(3),
    "maxScore" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Quiz" (
    "id" UUID NOT NULL,
    "kind" "QuizKind" NOT NULL,
    "title" TEXT NOT NULL,
    "passingScore" INTEGER NOT NULL DEFAULT 70,
    "timeLimitMin" INTEGER,
    "maxAttempts" INTEGER,
    "randomized" BOOLEAN NOT NULL DEFAULT false,
    "dayId" UUID,
    "weekId" UUID,
    "milestoneId" UUID,
    "programId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionOption" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Milestone" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "afterWeekIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MilestoneRequirement" (
    "id" UUID NOT NULL,
    "milestoneId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MilestoneRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSession" (
    "id" UUID NOT NULL,
    "weekId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "meetingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Week_programId_sortOrder_key" ON "Week"("programId", "sortOrder");
CREATE INDEX "Week_programId_idx" ON "Week"("programId");
CREATE UNIQUE INDEX "Day_weekId_sortOrder_key" ON "Day"("weekId", "sortOrder");
CREATE INDEX "Day_weekId_idx" ON "Day"("weekId");
CREATE UNIQUE INDEX "Lesson_dayId_sortOrder_key" ON "Lesson"("dayId", "sortOrder");
CREATE INDEX "Lesson_dayId_idx" ON "Lesson"("dayId");
CREATE UNIQUE INDEX "Video_dayId_sortOrder_key" ON "Video"("dayId", "sortOrder");
CREATE INDEX "Video_dayId_idx" ON "Video"("dayId");
CREATE UNIQUE INDEX "Resource_dayId_sortOrder_key" ON "Resource"("dayId", "sortOrder");
CREATE INDEX "Resource_dayId_idx" ON "Resource"("dayId");
CREATE UNIQUE INDEX "Reel_dayId_sortOrder_key" ON "Reel"("dayId", "sortOrder");
CREATE INDEX "Reel_dayId_idx" ON "Reel"("dayId");
CREATE UNIQUE INDEX "Assignment_dayId_sortOrder_key" ON "Assignment"("dayId", "sortOrder");
CREATE INDEX "Assignment_dayId_idx" ON "Assignment"("dayId");
CREATE UNIQUE INDEX "Quiz_milestoneId_key" ON "Quiz"("milestoneId");
CREATE INDEX "Quiz_dayId_idx" ON "Quiz"("dayId");
CREATE INDEX "Quiz_weekId_idx" ON "Quiz"("weekId");
CREATE INDEX "Quiz_programId_idx" ON "Quiz"("programId");
CREATE INDEX "Quiz_kind_idx" ON "Quiz"("kind");
CREATE UNIQUE INDEX "Question_quizId_sortOrder_key" ON "Question"("quizId", "sortOrder");
CREATE INDEX "Question_quizId_idx" ON "Question"("quizId");
CREATE UNIQUE INDEX "QuestionOption_questionId_sortOrder_key" ON "QuestionOption"("questionId", "sortOrder");
CREATE INDEX "QuestionOption_questionId_idx" ON "QuestionOption"("questionId");
CREATE UNIQUE INDEX "Milestone_programId_sortOrder_key" ON "Milestone"("programId", "sortOrder");
CREATE INDEX "Milestone_programId_idx" ON "Milestone"("programId");
CREATE UNIQUE INDEX "MilestoneRequirement_milestoneId_sortOrder_key" ON "MilestoneRequirement"("milestoneId", "sortOrder");
CREATE INDEX "MilestoneRequirement_milestoneId_idx" ON "MilestoneRequirement"("milestoneId");
CREATE UNIQUE INDEX "TrainingSession_weekId_sortOrder_key" ON "TrainingSession"("weekId", "sortOrder");
CREATE INDEX "TrainingSession_weekId_idx" ON "TrainingSession"("weekId");

ALTER TABLE "Week" ADD CONSTRAINT "Week_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Day" ADD CONSTRAINT "Day_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Video" ADD CONSTRAINT "Video_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reel" ADD CONSTRAINT "Reel_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MilestoneRequirement" ADD CONSTRAINT "MilestoneRequirement_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;
