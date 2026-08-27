-- CreateTable
CREATE TABLE "ProgramBatch" (
  "id" UUID NOT NULL,
  "programId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProgramBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramBatch_programId_name_key" ON "ProgramBatch"("programId", "name");
CREATE INDEX "ProgramBatch_programId_idx" ON "ProgramBatch"("programId");
CREATE INDEX "ProgramBatch_createdByUserId_idx" ON "ProgramBatch"("createdByUserId");

ALTER TABLE "ProgramBatch"
  ADD CONSTRAINT "ProgramBatch_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgramBatch"
  ADD CONSTRAINT "ProgramBatch_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "batchId" UUID;

CREATE INDEX "Enrollment_batchId_idx" ON "Enrollment"("batchId");

ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ProgramBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
