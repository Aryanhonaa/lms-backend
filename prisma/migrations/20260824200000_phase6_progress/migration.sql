-- CreateEnum
CREATE TYPE "MilestoneRequirementKind" AS ENUM ('WEEKS_COMPLETED', 'ASSESSMENTS_PASSED', 'ASSIGNMENTS_COMPLETE', 'ATTENDANCE', 'CUSTOM');

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "progressSnapshot" JSONB;

-- AlterTable
ALTER TABLE "MilestoneRequirement" ADD COLUMN "kind" "MilestoneRequirementKind" NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "MilestoneRequirement" ADD COLUMN "targetCount" INTEGER NOT NULL DEFAULT 1;
