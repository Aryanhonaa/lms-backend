-- AlterTable
CREATE TYPE "CourseOutcome" AS ENUM ('PENDING', 'PASSED', 'FAILED');

ALTER TABLE "Enrollment" ADD COLUMN "courseOutcome" "CourseOutcome" NOT NULL DEFAULT 'PENDING';

CREATE INDEX "Enrollment_courseOutcome_idx" ON "Enrollment"("courseOutcome");
