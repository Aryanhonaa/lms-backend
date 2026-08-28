-- CreateEnum
CREATE TYPE "QuizRevealMode" AS ENUM ('HIDDEN', 'IMMEDIATE', 'SCHEDULED');

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN "revealMode" "QuizRevealMode" NOT NULL DEFAULT 'IMMEDIATE';
ALTER TABLE "Quiz" ADD COLUMN "revealAt" TIMESTAMP(3);
ALTER TABLE "Quiz" ADD COLUMN "answersRevealedAnnouncedAt" TIMESTAMP(3);
