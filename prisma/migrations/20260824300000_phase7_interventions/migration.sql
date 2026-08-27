-- CreateEnum
CREATE TYPE "InterventionTrigger" AS ENUM ('PROGRESS_BELOW_THRESHOLD', 'EXAM_SCORE_BELOW_THRESHOLD');

-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IndividualRequirementType" AS ENUM ('VIDEO', 'READING', 'QUIZ', 'ASSIGNMENT', 'SESSION', 'EXAM_RETRY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IndividualRequirementStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');

-- AlterTable
ALTER TABLE "Program" ADD COLUMN "progressThreshold" DECIMAL(5,2) NOT NULL DEFAULT 60;
ALTER TABLE "Program" ADD COLUMN "examScoreThreshold" DECIMAL(5,2) NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "InterventionFlag" (
    "id" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "trigger" "InterventionTrigger" NOT NULL,
    "status" "InterventionStatus" NOT NULL DEFAULT 'OPEN',
    "progressPercent" DECIMAL(5,2) NOT NULL,
    "examScore" DECIMAL(5,2),
    "quizId" UUID,
    "attemptId" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterventionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndividualRequirement" (
    "id" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "assignedByUserId" UUID NOT NULL,
    "interventionFlagId" UUID,
    "type" "IndividualRequirementType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "trainerMessage" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "deadline" TIMESTAMP(3),
    "status" "IndividualRequirementStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndividualRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterventionFlag_enrollmentId_status_idx" ON "InterventionFlag"("enrollmentId", "status");

-- CreateIndex
CREATE INDEX "InterventionFlag_programId_status_idx" ON "InterventionFlag"("programId", "status");

-- CreateIndex
CREATE INDEX "InterventionFlag_trigger_status_idx" ON "InterventionFlag"("trigger", "status");

-- CreateIndex
CREATE INDEX "InterventionFlag_quizId_idx" ON "InterventionFlag"("quizId");

-- CreateIndex
CREATE UNIQUE INDEX "InterventionFlag_open_progress_key" ON "InterventionFlag"("enrollmentId", "trigger") WHERE "status" = 'OPEN' AND "trigger" = 'PROGRESS_BELOW_THRESHOLD';

-- CreateIndex
CREATE UNIQUE INDEX "InterventionFlag_open_exam_key" ON "InterventionFlag"("enrollmentId", "trigger", "quizId") WHERE "status" = 'OPEN' AND "trigger" = 'EXAM_SCORE_BELOW_THRESHOLD';

-- CreateIndex
CREATE INDEX "IndividualRequirement_enrollmentId_status_idx" ON "IndividualRequirement"("enrollmentId", "status");

-- CreateIndex
CREATE INDEX "IndividualRequirement_assignedByUserId_idx" ON "IndividualRequirement"("assignedByUserId");

-- CreateIndex
CREATE INDEX "IndividualRequirement_interventionFlagId_idx" ON "IndividualRequirement"("interventionFlagId");

-- CreateIndex
CREATE INDEX "IndividualRequirement_deadline_idx" ON "IndividualRequirement"("deadline");

-- AddForeignKey
ALTER TABLE "InterventionFlag" ADD CONSTRAINT "InterventionFlag_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionFlag" ADD CONSTRAINT "InterventionFlag_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionFlag" ADD CONSTRAINT "InterventionFlag_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualRequirement" ADD CONSTRAINT "IndividualRequirement_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualRequirement" ADD CONSTRAINT "IndividualRequirement_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualRequirement" ADD CONSTRAINT "IndividualRequirement_interventionFlagId_fkey" FOREIGN KEY ("interventionFlagId") REFERENCES "InterventionFlag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
