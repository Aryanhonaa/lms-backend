-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'WRITTEN');

-- AlterTable
ALTER TABLE "Question"
  ADD COLUMN "type" "QuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE',
  ADD COLUMN "modelAnswer" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "AssessmentAnswer"
  ADD COLUMN "textAnswer" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trainerComment" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "AssessmentAttempt"
  ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gradedAt" TIMESTAMP(3),
  ADD COLUMN "gradedByUserId" UUID;

CREATE INDEX "AssessmentAttempt_quizId_needsReview_idx" ON "AssessmentAttempt"("quizId", "needsReview");

ALTER TABLE "AssessmentAttempt"
  ADD CONSTRAINT "AssessmentAttempt_gradedByUserId_fkey"
  FOREIGN KEY ("gradedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
