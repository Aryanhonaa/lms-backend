-- CreateTable
CREATE TABLE "QuizBatchAnswerRelease" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "answersVisible" BOOLEAN NOT NULL DEFAULT false,
    "revealedAt" TIMESTAMP(3),
    "revealedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizBatchAnswerRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuizBatchAnswerRelease_batchId_idx" ON "QuizBatchAnswerRelease"("batchId");

-- CreateIndex
CREATE INDEX "QuizBatchAnswerRelease_quizId_idx" ON "QuizBatchAnswerRelease"("quizId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizBatchAnswerRelease_quizId_batchId_key" ON "QuizBatchAnswerRelease"("quizId", "batchId");

-- AddForeignKey
ALTER TABLE "QuizBatchAnswerRelease" ADD CONSTRAINT "QuizBatchAnswerRelease_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizBatchAnswerRelease" ADD CONSTRAINT "QuizBatchAnswerRelease_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProgramBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizBatchAnswerRelease" ADD CONSTRAINT "QuizBatchAnswerRelease_revealedByUserId_fkey" FOREIGN KEY ("revealedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
