-- CreateTable
CREATE TABLE "AppUsageSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "programId" UUID,
    "batchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUsageSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppUsageSession_userId_startedAt_idx" ON "AppUsageSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AppUsageSession_userId_endedAt_idx" ON "AppUsageSession"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "AppUsageSession_startedAt_idx" ON "AppUsageSession"("startedAt");

-- CreateIndex
CREATE INDEX "AppUsageSession_endedAt_idx" ON "AppUsageSession"("endedAt");

-- CreateIndex
CREATE INDEX "AppUsageSession_programId_idx" ON "AppUsageSession"("programId");

-- CreateIndex
CREATE INDEX "AppUsageSession_batchId_idx" ON "AppUsageSession"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "AppUsageSession_userId_open_key" ON "AppUsageSession"("userId") WHERE "endedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "AppUsageSession" ADD CONSTRAINT "AppUsageSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppUsageSession" ADD CONSTRAINT "AppUsageSession_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppUsageSession" ADD CONSTRAINT "AppUsageSession_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProgramBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
