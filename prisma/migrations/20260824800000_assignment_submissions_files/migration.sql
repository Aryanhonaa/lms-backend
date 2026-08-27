-- AlterEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- AlterTable
ALTER TABLE "Assignment"
  ADD COLUMN "instructions" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "status" "AssignmentStatus" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "allowFileUpload" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowTextResponse" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowLateSubmission" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowResubmission" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "allowedFileTypes" TEXT NOT NULL DEFAULT 'pdf,doc,docx,png,jpg,jpeg,zip,txt',
  ADD COLUMN "maxFileSizeMb" INTEGER NOT NULL DEFAULT 25;

CREATE INDEX "Assignment_status_idx" ON "Assignment"("status");

-- AlterTable
ALTER TABLE "AssignmentSubmission" ADD COLUMN "isLate" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS "AssignmentSubmission_enrollmentId_assignmentId_key";

CREATE UNIQUE INDEX "AssignmentSubmission_enrollmentId_assignmentId_revision_key"
  ON "AssignmentSubmission"("enrollmentId", "assignmentId", "revision");

-- CreateTable
CREATE TABLE "AssignmentSubmissionFile" (
  "id" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'local',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssignmentSubmissionFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssignmentSubmissionFile_submissionId_idx" ON "AssignmentSubmissionFile"("submissionId");
CREATE UNIQUE INDEX "AssignmentSubmissionFile_fileKey_key" ON "AssignmentSubmissionFile"("fileKey");

ALTER TABLE "AssignmentSubmissionFile"
  ADD CONSTRAINT "AssignmentSubmissionFile_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
