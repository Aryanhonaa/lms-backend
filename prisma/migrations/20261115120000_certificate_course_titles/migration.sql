-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN "courseTitles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
