-- Link NHT ops batches to an LMS course + enrollment roster
ALTER TABLE "NhtBatch" ADD COLUMN "programId" UUID;
ALTER TABLE "NhtBatch" ADD COLUMN "programBatchId" UUID;

CREATE INDEX "NhtBatch_programId_idx" ON "NhtBatch"("programId");
CREATE INDEX "NhtBatch_programBatchId_idx" ON "NhtBatch"("programBatchId");

ALTER TABLE "NhtBatch"
  ADD CONSTRAINT "NhtBatch_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NhtBatch"
  ADD CONSTRAINT "NhtBatch_programBatchId_fkey"
  FOREIGN KEY ("programBatchId") REFERENCES "ProgramBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
