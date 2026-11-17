ALTER TABLE "ProgramBatch" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "ProgramBatch" AS linked
SET "sortOrder" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "linkedFromBatchId" ORDER BY "createdAt" ASC) AS rn
  FROM "ProgramBatch"
  WHERE "linkedFromBatchId" IS NOT NULL
) sub
WHERE linked.id = sub.id;

CREATE INDEX "ProgramBatch_linkedFromBatchId_sortOrder_idx" ON "ProgramBatch"("linkedFromBatchId", "sortOrder");
