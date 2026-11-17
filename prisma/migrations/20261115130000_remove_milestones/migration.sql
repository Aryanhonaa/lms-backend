-- Remove curriculum milestones (Milestone, MilestoneRequirement, MILESTONE_EXAM, MILESTONE_MASTER).
-- Batch-tracker operational milestones are not stored in the database and are unaffected.

-- 1. Delete trainee achievements for MILESTONE_MASTER (if the tables exist)
DO $$
BEGIN
  IF to_regclass('"TraineeAchievement"') IS NOT NULL AND to_regclass('"Achievement"') IS NOT NULL THEN
    DELETE FROM "TraineeAchievement"
    WHERE "achievementId" IN (
      SELECT "id" FROM "Achievement" WHERE "key"::text = 'MILESTONE_MASTER'
    );
  END IF;
END $$;

-- 2. Delete the MILESTONE_MASTER catalog row
DO $$
BEGIN
  IF to_regclass('"Achievement"') IS NOT NULL THEN
    DELETE FROM "Achievement" WHERE "key"::text = 'MILESTONE_MASTER';
  END IF;
END $$;

-- 3. Delete milestone exam quizzes (questions, attempts, answers cascade via FKs)
DELETE FROM "Quiz" WHERE "kind"::text = 'MILESTONE_EXAM';

-- 4. Drop Quiz.milestoneId (FK, unique index, column)
ALTER TABLE "Quiz" DROP CONSTRAINT IF EXISTS "Quiz_milestoneId_fkey";
DROP INDEX IF EXISTS "Quiz_milestoneId_key";
ALTER TABLE "Quiz" DROP COLUMN IF EXISTS "milestoneId";

-- 5. Drop milestone tables
DROP TABLE IF EXISTS "MilestoneRequirement";
DROP TABLE IF EXISTS "Milestone";

-- 6. Drop requirement kind enum
DROP TYPE IF EXISTS "MilestoneRequirementKind";

-- 7. Recreate QuizKind without MILESTONE_EXAM
CREATE TYPE "QuizKind_new" AS ENUM ('PRACTICE_QUIZ', 'WEEKLY_QUIZ', 'WEEKLY_EXAM', 'FINAL_EXAM');
ALTER TABLE "Quiz" ALTER COLUMN "kind" TYPE "QuizKind_new" USING ("kind"::text::"QuizKind_new");
DROP TYPE "QuizKind";
ALTER TYPE "QuizKind_new" RENAME TO "QuizKind";

-- 8. Recreate AchievementKey without MILESTONE_MASTER
CREATE TYPE "AchievementKey_new" AS ENUM (
  'FIRST_COURSE_COMPLETED',
  'PERFECT_QUIZ',
  'TOP_PERFORMER',
  'PERFECT_ATTENDANCE',
  'LEARNING_STREAK',
  'EXAM_CHAMPION'
);
ALTER TABLE "Achievement" ALTER COLUMN "key" TYPE "AchievementKey_new" USING ("key"::text::"AchievementKey_new");
DROP TYPE "AchievementKey";
ALTER TYPE "AchievementKey_new" RENAME TO "AchievementKey";
