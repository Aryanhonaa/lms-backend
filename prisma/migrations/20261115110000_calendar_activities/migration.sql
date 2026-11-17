-- Trainer-scheduled calendar activities for one trainee or an entire batch.
CREATE TABLE "CalendarActivity" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "traineeUserId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CalendarActivity_programId_startsAt_idx" ON "CalendarActivity"("programId", "startsAt");
CREATE INDEX "CalendarActivity_batchId_startsAt_idx" ON "CalendarActivity"("batchId", "startsAt");
CREATE INDEX "CalendarActivity_traineeUserId_startsAt_idx" ON "CalendarActivity"("traineeUserId", "startsAt");
CREATE INDEX "CalendarActivity_createdByUserId_idx" ON "CalendarActivity"("createdByUserId");

ALTER TABLE "CalendarActivity" ADD CONSTRAINT "CalendarActivity_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarActivity" ADD CONSTRAINT "CalendarActivity_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProgramBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarActivity" ADD CONSTRAINT "CalendarActivity_traineeUserId_fkey" FOREIGN KEY ("traineeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarActivity" ADD CONSTRAINT "CalendarActivity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
