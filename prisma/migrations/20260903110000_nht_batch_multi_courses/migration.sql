-- Multi-course links for NHT batches
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "NhtBatchProgram" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batchId" UUID NOT NULL,
  "programId" UUID NOT NULL,
  "programBatchId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NhtBatchProgram_pkey" PRIMARY KEY ("id")
);

INSERT INTO "NhtBatchProgram" ("batchId", "programId", "programBatchId", "createdAt")
SELECT "id", "programId", "programBatchId", CURRENT_TIMESTAMP
FROM "NhtBatch"
WHERE "programId" IS NOT NULL AND "programBatchId" IS NOT NULL;

CREATE UNIQUE INDEX "NhtBatchProgram_batchId_programId_key" ON "NhtBatchProgram"("batchId", "programId");
CREATE INDEX "NhtBatchProgram_programId_idx" ON "NhtBatchProgram"("programId");
CREATE INDEX "NhtBatchProgram_programBatchId_idx" ON "NhtBatchProgram"("programBatchId");

ALTER TABLE "NhtBatchProgram"
  ADD CONSTRAINT "NhtBatchProgram_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "NhtBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NhtBatchProgram"
  ADD CONSTRAINT "NhtBatchProgram_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NhtBatchProgram"
  ADD CONSTRAINT "NhtBatchProgram_programBatchId_fkey"
  FOREIGN KEY ("programBatchId") REFERENCES "ProgramBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NhtBatch" DROP CONSTRAINT IF EXISTS "NhtBatch_programId_fkey";
ALTER TABLE "NhtBatch" DROP CONSTRAINT IF EXISTS "NhtBatch_programBatchId_fkey";
DROP INDEX IF EXISTS "NhtBatch_programId_idx";
DROP INDEX IF EXISTS "NhtBatch_programBatchId_idx";
ALTER TABLE "NhtBatch" DROP COLUMN IF EXISTS "programId";
ALTER TABLE "NhtBatch" DROP COLUMN IF EXISTS "programBatchId";
