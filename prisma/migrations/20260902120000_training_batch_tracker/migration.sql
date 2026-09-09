-- CreateEnum
CREATE TYPE "TrainingProcess" AS ENUM ('VOICE_SALES', 'NON_VOICE_SALES_SUPPORT');

-- CreateEnum
CREATE TYPE "TrainingBatchStatus" AS ENUM ('ONGOING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TrackerTraineeStatus" AS ENUM ('JOINED', 'IN_TRAINING', 'HR_ATTRITION', 'TRAINING_ATTRITION', 'EXAM_ELIGIBLE', 'EXAM_PENDING', 'EXAM_FAILED', 'CERTIFIED', 'HANDOVER_PENDING', 'HANDED_OVER', 'TNI', 'ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "TrackerAttritionKind" AS ENUM ('HR', 'TRAINING');

-- CreateEnum
CREATE TYPE "TrackerAuditType" AS ENUM ('CALL', 'CHAT');

-- CreateEnum
CREATE TYPE "TrackerTniStatus" AS ENUM ('OPEN', 'IN_SUPPORT', 'REAUDIT_PENDING', 'CLEARED', 'PERFORMANCE_WARNING', 'SUPERVISOR_REVIEW', 'CONTINUE_MONITORING', 'INTERNAL_TRANSFER', 'TERMINATED');

-- CreateEnum
CREATE TYPE "TrackerTniDecision" AS ENUM ('CLEARED', 'CONTINUE_MONITORING', 'INTERNAL_TRANSFER', 'TERMINATED');

-- CreateTable
CREATE TABLE "NhtBatch" (
    "id" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "process" "TrainingProcess" NOT NULL,
    "trainingStartDate" DATE NOT NULL,
    "targetCompletionDate" DATE NOT NULL,
    "actualCompletionDate" DATE,
    "salesTrainerId" UUID NOT NULL,
    "filesTrainerId" UUID,
    "status" "TrainingBatchStatus" NOT NULL DEFAULT 'ONGOING',
    "day1Hc" INTEGER NOT NULL DEFAULT 0,
    "day7Hc" INTEGER,
    "day7FinalizedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NhtBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NhtTrainee" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "batchId" UUID,
    "process" "TrainingProcess" NOT NULL,
    "trainerId" UUID,
    "team" TEXT NOT NULL DEFAULT '',
    "supervisorName" TEXT NOT NULL DEFAULT '',
    "joiningDate" DATE NOT NULL,
    "status" "TrackerTraineeStatus" NOT NULL DEFAULT 'JOINED',
    "examEligible" BOOLEAN NOT NULL DEFAULT false,
    "examAppeared" BOOLEAN NOT NULL DEFAULT false,
    "examPassed" BOOLEAN NOT NULL DEFAULT false,
    "examDate" DATE,
    "examRemarks" TEXT NOT NULL DEFAULT '',
    "handoverDate" DATE,
    "handoverTeam" TEXT NOT NULL DEFAULT '',
    "handoverSupervisor" TEXT NOT NULL DEFAULT '',
    "handoverRemarks" TEXT NOT NULL DEFAULT '',
    "terminatedAt" TIMESTAMP(3),
    "terminatedByUserId" UUID,
    "terminationConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "terminationReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NhtTrainee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NhtAttrition" (
    "id" UUID NOT NULL,
    "traineeId" UUID NOT NULL,
    "kind" "TrackerAttritionKind" NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "remarks" TEXT NOT NULL DEFAULT '',
    "recordedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NhtAttrition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NhtLcaAudit" (
    "id" UUID NOT NULL,
    "traineeId" UUID NOT NULL,
    "batchId" UUID,
    "weekNumber" INTEGER NOT NULL,
    "auditDate" DATE NOT NULL,
    "auditType" "TrackerAuditType" NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "auditorUserId" UUID NOT NULL,
    "remarks" TEXT NOT NULL DEFAULT '',
    "isReAudit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NhtLcaAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NhtTniCase" (
    "id" UUID NOT NULL,
    "traineeId" UUID NOT NULL,
    "batchId" UUID,
    "status" "TrackerTniStatus" NOT NULL DEFAULT 'OPEN',
    "startDate" DATE NOT NULL,
    "identifiedGap" TEXT NOT NULL DEFAULT '',
    "trainerId" UUID NOT NULL,
    "supportPlan" TEXT NOT NULL DEFAULT '',
    "supportStartDate" DATE,
    "reviewDate" DATE,
    "trainerRemarks" TEXT NOT NULL DEFAULT '',
    "averageScore" DECIMAL(5,2) NOT NULL,
    "reAuditScore" DECIMAL(5,2),
    "finalDecision" "TrackerTniDecision",
    "decisionAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NhtTniCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NhtBatch_code_key" ON "NhtBatch"("code");
CREATE UNIQUE INDEX "NhtBatch_year_month_batchNumber_key" ON "NhtBatch"("year", "month", "batchNumber");
CREATE INDEX "NhtBatch_status_idx" ON "NhtBatch"("status");
CREATE INDEX "NhtBatch_salesTrainerId_idx" ON "NhtBatch"("salesTrainerId");
CREATE INDEX "NhtBatch_year_month_idx" ON "NhtBatch"("year", "month");
CREATE INDEX "NhtTrainee_userId_idx" ON "NhtTrainee"("userId");
CREATE INDEX "NhtTrainee_batchId_idx" ON "NhtTrainee"("batchId");
CREATE INDEX "NhtTrainee_status_idx" ON "NhtTrainee"("status");
CREATE INDEX "NhtTrainee_trainerId_idx" ON "NhtTrainee"("trainerId");
CREATE INDEX "NhtTrainee_process_idx" ON "NhtTrainee"("process");
CREATE INDEX "NhtAttrition_traineeId_idx" ON "NhtAttrition"("traineeId");
CREATE INDEX "NhtAttrition_kind_idx" ON "NhtAttrition"("kind");
CREATE INDEX "NhtLcaAudit_traineeId_auditDate_idx" ON "NhtLcaAudit"("traineeId", "auditDate");
CREATE INDEX "NhtLcaAudit_batchId_idx" ON "NhtLcaAudit"("batchId");
CREATE INDEX "NhtLcaAudit_auditorUserId_idx" ON "NhtLcaAudit"("auditorUserId");
CREATE INDEX "NhtTniCase_traineeId_status_idx" ON "NhtTniCase"("traineeId", "status");
CREATE INDEX "NhtTniCase_trainerId_idx" ON "NhtTniCase"("trainerId");
CREATE INDEX "NhtTniCase_batchId_idx" ON "NhtTniCase"("batchId");

ALTER TABLE "NhtBatch" ADD CONSTRAINT "NhtBatch_salesTrainerId_fkey" FOREIGN KEY ("salesTrainerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NhtBatch" ADD CONSTRAINT "NhtBatch_filesTrainerId_fkey" FOREIGN KEY ("filesTrainerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NhtBatch" ADD CONSTRAINT "NhtBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NhtTrainee" ADD CONSTRAINT "NhtTrainee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NhtTrainee" ADD CONSTRAINT "NhtTrainee_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "NhtBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NhtTrainee" ADD CONSTRAINT "NhtTrainee_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NhtTrainee" ADD CONSTRAINT "NhtTrainee_terminatedByUserId_fkey" FOREIGN KEY ("terminatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NhtAttrition" ADD CONSTRAINT "NhtAttrition_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "NhtTrainee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NhtAttrition" ADD CONSTRAINT "NhtAttrition_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NhtLcaAudit" ADD CONSTRAINT "NhtLcaAudit_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "NhtTrainee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NhtLcaAudit" ADD CONSTRAINT "NhtLcaAudit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "NhtBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NhtLcaAudit" ADD CONSTRAINT "NhtLcaAudit_auditorUserId_fkey" FOREIGN KEY ("auditorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NhtTniCase" ADD CONSTRAINT "NhtTniCase_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "NhtTrainee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NhtTniCase" ADD CONSTRAINT "NhtTniCase_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "NhtBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NhtTniCase" ADD CONSTRAINT "NhtTniCase_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NhtTniCase" ADD CONSTRAINT "NhtTniCase_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
