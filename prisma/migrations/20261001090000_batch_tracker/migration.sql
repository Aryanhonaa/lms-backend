-- AlterEnum
ALTER TYPE "EnrollmentStatus" ADD VALUE 'TERMINATED';

-- CreateEnum
CREATE TYPE "LineOfBusiness" AS ENUM ('VOICE', 'NON_VOICE');

-- CreateEnum
CREATE TYPE "BatchTrainerRole" AS ENUM ('SALES', 'SALES_SUPPORT');

-- AlterTable
ALTER TABLE "ProgramBatch"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "month" INTEGER,
  ADD COLUMN "year" INTEGER,
  ADD COLUMN "batchNumber" INTEGER,
  ADD COLUMN "lineOfBusiness" "LineOfBusiness",
  ADD COLUMN "actualCompletionDate" TIMESTAMP(3);

CREATE UNIQUE INDEX "ProgramBatch_code_key" ON "ProgramBatch"("code");
CREATE INDEX "ProgramBatch_year_month_idx" ON "ProgramBatch"("year", "month");

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "lineOfBusiness" "LineOfBusiness",
    "supervisorName" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- AlterTable
ALTER TABLE "Enrollment"
  ADD COLUMN "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "exitedAt" TIMESTAMP(3),
  ADD COLUMN "exitReason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "exitedByUserId" UUID,
  ADD COLUMN "handedOverAt" TIMESTAMP(3),
  ADD COLUMN "teamId" UUID;

UPDATE "Enrollment" SET "joinedAt" = "createdAt";

CREATE INDEX "Enrollment_teamId_idx" ON "Enrollment"("teamId");

ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_exitedByUserId_fkey"
  FOREIGN KEY ("exitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "BatchTrainer" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "BatchTrainerRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchTrainer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BatchTrainer_batchId_role_key" ON "BatchTrainer"("batchId", "role");
CREATE INDEX "BatchTrainer_userId_idx" ON "BatchTrainer"("userId");

ALTER TABLE "BatchTrainer"
  ADD CONSTRAINT "BatchTrainer_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ProgramBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BatchTrainer"
  ADD CONSTRAINT "BatchTrainer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateTable
CREATE TABLE "WorkCalendarSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "weeklyOffDays" INTEGER[] DEFAULT ARRAY[6]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCalendarSetting_pkey" PRIMARY KEY ("id")
);
