-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "linkedItemType" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "linkedItemId" UUID;

-- CreateIndex
CREATE INDEX "Assignment_linkedItemId_idx" ON "Assignment"("linkedItemId");
