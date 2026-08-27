-- Cloudflare R2 object storage references for curriculum media and content attachments.
-- Existing URL columns are preserved so current content keeps working.

-- AlterTable: Video
ALTER TABLE "Video"
  ADD COLUMN IF NOT EXISTS "fileKey" TEXT,
  ADD COLUMN IF NOT EXISTS "fileName" TEXT,
  ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "fileSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "storageProvider" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Video_fileKey_key" ON "Video"("fileKey");

-- AlterTable: Resource
ALTER TABLE "Resource"
  ADD COLUMN IF NOT EXISTS "fileKey" TEXT,
  ADD COLUMN IF NOT EXISTS "fileName" TEXT,
  ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "fileSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "storageProvider" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Resource_fileKey_key" ON "Resource"("fileKey");

-- AlterTable: Reel
ALTER TABLE "Reel"
  ADD COLUMN IF NOT EXISTS "fileKey" TEXT,
  ADD COLUMN IF NOT EXISTS "fileName" TEXT,
  ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "fileSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "storageProvider" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Reel_fileKey_key" ON "Reel"("fileKey");

-- CreateTable: ContentAttachment
CREATE TABLE IF NOT EXISTS "ContentAttachment" (
  "id" UUID NOT NULL,
  "lessonId" UUID,
  "assignmentId" UUID,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL DEFAULT '',
  "fileName" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'local',
  "uploadedByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentAttachment_fileKey_key" ON "ContentAttachment"("fileKey");
CREATE INDEX IF NOT EXISTS "ContentAttachment_lessonId_idx" ON "ContentAttachment"("lessonId");
CREATE INDEX IF NOT EXISTS "ContentAttachment_assignmentId_idx" ON "ContentAttachment"("assignmentId");
CREATE INDEX IF NOT EXISTS "ContentAttachment_uploadedByUserId_idx" ON "ContentAttachment"("uploadedByUserId");

ALTER TABLE "ContentAttachment"
  DROP CONSTRAINT IF EXISTS "ContentAttachment_lessonId_fkey",
  ADD CONSTRAINT "ContentAttachment_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentAttachment"
  DROP CONSTRAINT IF EXISTS "ContentAttachment_assignmentId_fkey",
  ADD CONSTRAINT "ContentAttachment_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentAttachment"
  DROP CONSTRAINT IF EXISTS "ContentAttachment_uploadedByUserId_fkey",
  ADD CONSTRAINT "ContentAttachment_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
