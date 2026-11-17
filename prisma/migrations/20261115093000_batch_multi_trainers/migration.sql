ALTER TYPE "BatchTrainerRole" ADD VALUE IF NOT EXISTS 'COLLABORATOR';

ALTER TABLE "BatchTrainer" DROP CONSTRAINT IF EXISTS "BatchTrainer_batchId_role_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BatchTrainer_batchId_userId_key'
  ) THEN
    ALTER TABLE "BatchTrainer" ADD CONSTRAINT "BatchTrainer_batchId_userId_key" UNIQUE ("batchId", "userId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BatchTrainer_batchId_role_idx" ON "BatchTrainer"("batchId", "role");
