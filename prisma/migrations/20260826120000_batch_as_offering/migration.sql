-- Capacity belongs to the run, not the course.
ALTER TABLE "ProgramBatch" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 25;

-- Existing unassigned enrollments become a default run so batchId can be required.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "ProgramBatch" (
  "id",
  "programId",
  "name",
  "description",
  "capacity",
  "createdByUserId",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  p."id",
  'Original run',
  '',
  25,
  p."createdByUserId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Program" p
WHERE EXISTS (
  SELECT 1 FROM "Enrollment" e
  WHERE e."programId" = p."id" AND e."batchId" IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM "ProgramBatch" b
  WHERE b."programId" = p."id" AND b."name" = 'Original run'
);

UPDATE "Enrollment" AS e
SET "batchId" = b."id"
FROM "ProgramBatch" AS b
WHERE e."batchId" IS NULL
  AND b."programId" = e."programId"
  AND b."name" = 'Original run';

ALTER TABLE "Enrollment" ALTER COLUMN "batchId" SET NOT NULL;

DROP INDEX IF EXISTS "Enrollment_programId_userId_key";

CREATE UNIQUE INDEX "Enrollment_batchId_userId_key" ON "Enrollment"("batchId", "userId");
CREATE INDEX "Enrollment_programId_idx" ON "Enrollment"("programId");

ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_batchId_fkey";
ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ProgramBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
