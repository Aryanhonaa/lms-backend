ALTER TABLE "ProgramBatch" ADD COLUMN IF NOT EXISTS "linkedFromBatchId" UUID;

ALTER TABLE "ProgramBatch" DROP CONSTRAINT IF EXISTS "ProgramBatch_linkedFromBatchId_fkey";
ALTER TABLE "ProgramBatch"
  ADD CONSTRAINT "ProgramBatch_linkedFromBatchId_fkey"
  FOREIGN KEY ("linkedFromBatchId") REFERENCES "ProgramBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ProgramBatch_linkedFromBatchId_idx" ON "ProgramBatch"("linkedFromBatchId");
