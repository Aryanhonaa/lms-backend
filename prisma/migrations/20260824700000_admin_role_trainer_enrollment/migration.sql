-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN' AFTER 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "enrolledByUserId" UUID;

-- CreateIndex
CREATE INDEX "Enrollment_enrolledByUserId_idx" ON "Enrollment"("enrolledByUserId");

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_enrolledByUserId_fkey" FOREIGN KEY ("enrolledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
