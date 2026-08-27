-- CreateEnum
CREATE TYPE "ContentItemType" AS ENUM ('LESSON', 'VIDEO', 'RESOURCE', 'REEL');

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "currentDayIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ContentCompletion" (
    "id" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "itemType" "ContentItemType" NOT NULL,
    "itemId" UUID NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCompletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentCompletion_enrollmentId_itemType_itemId_key" ON "ContentCompletion"("enrollmentId", "itemType", "itemId");
CREATE INDEX "ContentCompletion_enrollmentId_idx" ON "ContentCompletion"("enrollmentId");
CREATE INDEX "ContentCompletion_itemId_idx" ON "ContentCompletion"("itemId");

ALTER TABLE "ContentCompletion" ADD CONSTRAINT "ContentCompletion_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
