import { AssessmentAttemptStatus, type Prisma } from "../generated/prisma";
import { prisma } from "../config/prisma";

const questionInclude = {
  options: { orderBy: { sortOrder: "asc" as const } },
} as const;

const questionsQuery = {
  orderBy: { sortOrder: "asc" as const },
  include: questionInclude,
};

async function withLocation<T extends {
  dayId: string | null;
  weekId: string | null;
  programId: string | null;
}>(quiz: T) {
  const [day, week, program] = await Promise.all([
    quiz.dayId
      ? prisma.day.findUnique({
          where: { id: quiz.dayId },
          include: { week: { include: { program: true } } },
        })
      : Promise.resolve(null),
    quiz.weekId
      ? prisma.week.findUnique({
          where: { id: quiz.weekId },
          include: { program: true },
        })
      : Promise.resolve(null),
    quiz.programId ? prisma.program.findUnique({ where: { id: quiz.programId } }) : Promise.resolve(null),
  ]);

  return { ...quiz, day, week, program };
}

export const assessmentRepository = {
  async findQuiz(id: string) {
    const quiz = await prisma.quiz.findUnique({
      where: { id },
      include: { questions: questionsQuery },
    });
    return quiz ? withLocation(quiz) : null;
  },

  async findQuizzesForProgram(programId: string) {
    const quizzes = await prisma.quiz.findMany({
      where: {
        OR: [
          { programId },
          { week: { programId } },
          { day: { week: { programId } } },
        ],
      },
      include: { questions: questionsQuery },
      orderBy: { createdAt: "asc" },
    });
    return Promise.all(quizzes.map((quiz) => withLocation(quiz)));
  },

  async findQuizzesForTrainer(programIds: string[]) {
    if (programIds.length === 0) {
      return [];
    }
    const quizzes = await prisma.quiz.findMany({
      where: {
        OR: [
          { programId: { in: programIds } },
          { week: { programId: { in: programIds } } },
          { day: { week: { programId: { in: programIds } } } },
        ],
      },
      include: {
        questions: questionsQuery,
        _count: { select: { attempts: true, questions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(quizzes.map((quiz) => withLocation(quiz)));
  },

  findAttemptsForEnrollment(enrollmentId: string, quizId?: string) {
    return prisma.assessmentAttempt.findMany({
      where: { enrollmentId, ...(quizId ? { quizId } : {}) },
      include: {
        answers: true,
        quiz: { select: { id: true, title: true, kind: true, passingScore: true } },
      },
      orderBy: { attemptNumber: "asc" },
    });
  },

  /** Latest closed attempt for this trainee on a quiz, across all of their enrollments. */
  findLatestClosedAttemptForUserQuiz(userId: string, quizId: string) {
    return prisma.assessmentAttempt.findFirst({
      where: {
        quizId,
        status: { in: [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.TIMED_OUT] },
        enrollment: { userId, status: { notIn: ["WITHDRAWN", "TERMINATED", "REMOVED"] } },
      },
      select: {
        id: true,
        enrollmentId: true,
        enrollment: { select: { batchId: true, programId: true } },
      },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    });
  },

  async countAttemptsByQuiz(quizIds: string[], batchId?: string) {
    if (quizIds.length === 0) {
      return new Map<string, number>();
    }
    const rows = await prisma.assessmentAttempt.findMany({
      where: {
        quizId: { in: quizIds },
        ...(batchId ? { enrollment: { batchId } } : {}),
      },
      select: { quizId: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.quizId, (counts.get(row.quizId) ?? 0) + 1);
    }
    return counts;
  },

  findAttemptsForQuiz(quizId: string, batchId?: string) {
    return prisma.assessmentAttempt.findMany({
      where: {
        quizId,
        ...(batchId ? { enrollment: { batchId } } : {}),
      },
      include: {
        answers: true,
        gradedBy: { select: { id: true, name: true, email: true } },
        enrollment: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            batch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ enrollmentId: "asc" }, { attemptNumber: "asc" }],
    });
  },

  findOpenAttempt(enrollmentId: string, quizId: string) {
    return prisma.assessmentAttempt.findFirst({
      where: { enrollmentId, quizId, status: AssessmentAttemptStatus.IN_PROGRESS },
      include: { answers: true },
    });
  },

  async findAttempt(id: string) {
    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id },
      include: {
        answers: true,
        gradedBy: { select: { id: true, name: true, email: true } },
        enrollment: true,
        quiz: {
          include: { questions: questionsQuery },
        },
      },
    });
    if (!attempt) {
      return null;
    }
    return { ...attempt, quiz: await withLocation(attempt.quiz) };
  },

  countClosedAttempts(enrollmentId: string, quizId: string) {
    return prisma.assessmentAttempt.count({
      where: {
        enrollmentId,
        quizId,
        status: { in: [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.TIMED_OUT] },
      },
    });
  },

  nextAttemptNumber(enrollmentId: string, quizId: string) {
    return prisma.assessmentAttempt
      .aggregate({
        where: { enrollmentId, quizId },
        _max: { attemptNumber: true },
      })
      .then((result) => (result._max.attemptNumber ?? 0) + 1);
  },

  createAttempt(data: {
    enrollmentId: string;
    quizId: string;
    attemptNumber: number;
    deadlineAt: Date | null;
    questionSnapshot: Prisma.InputJsonValue;
  }) {
    return prisma.assessmentAttempt.create({
      data: {
        enrollmentId: data.enrollmentId,
        quizId: data.quizId,
        attemptNumber: data.attemptNumber,
        deadlineAt: data.deadlineAt,
        questionSnapshot: data.questionSnapshot,
      },
    });
  },

  saveGradedAttempt(input: {
    attemptId: string;
    status: AssessmentAttemptStatus;
    score: number | null;
    passed: boolean | null;
    needsReview: boolean;
    answers: Array<{
      questionId: string;
      selectedOptionIds: string[];
      textAnswer: string;
      isCorrect: boolean;
      pointsAwarded: number;
      needsReview: boolean;
    }>;
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.assessmentAnswer.deleteMany({ where: { attemptId: input.attemptId } });
      if (input.answers.length > 0) {
        await tx.assessmentAnswer.createMany({
          data: input.answers.map((answer) => ({
            attemptId: input.attemptId,
            questionId: answer.questionId,
            selectedOptionIds: answer.selectedOptionIds,
            textAnswer: answer.textAnswer,
            isCorrect: answer.isCorrect,
            pointsAwarded: answer.pointsAwarded,
            needsReview: answer.needsReview,
          })),
        });
      }

      return tx.assessmentAttempt.update({
        where: { id: input.attemptId },
        data: {
          status: input.status,
          score: input.score,
          passed: input.passed,
          needsReview: input.needsReview,
          submittedAt: new Date(),
        },
        include: { answers: true },
      });
    });
  },

  saveTrainerGrades(input: {
    attemptId: string;
    gradedByUserId: string;
    grades: Array<{ questionId: string; pointsAwarded: number; isCorrect: boolean; comment: string }>;
    score: number | null;
    passed: boolean | null;
    needsReview: boolean;
  }) {
    return prisma.$transaction(async (tx) => {
      for (const grade of input.grades) {
        await tx.assessmentAnswer.update({
          where: { attemptId_questionId: { attemptId: input.attemptId, questionId: grade.questionId } },
          data: {
            pointsAwarded: grade.pointsAwarded,
            isCorrect: grade.isCorrect,
            trainerComment: grade.comment,
            needsReview: false,
          },
        });
      }
      return tx.assessmentAttempt.update({
        where: { id: input.attemptId },
        data: {
          score: input.score,
          passed: input.passed,
          needsReview: input.needsReview,
          gradedAt: new Date(),
          gradedByUserId: input.gradedByUserId,
        },
        include: {
          answers: true,
          gradedBy: { select: { id: true, name: true, email: true } },
        },
      });
    });
  },

  findGradingQueue(quizIds: string[], view: "pending" | "graded", gradedSince?: Date, batchId?: string) {
    if (quizIds.length === 0) {
      return Promise.resolve([]);
    }
    return prisma.assessmentAttempt.findMany({
      where: {
        quizId: { in: quizIds },
        status: { in: [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.TIMED_OUT] },
        ...(batchId ? { enrollment: { batchId } } : {}),
        ...(view === "pending"
          ? { needsReview: true }
          : { needsReview: false, gradedAt: { not: null, ...(gradedSince ? { gte: gradedSince } : {}) } }),
      },
      select: {
        id: true,
        quizId: true,
        attemptNumber: true,
        status: true,
        score: true,
        passed: true,
        needsReview: true,
        submittedAt: true,
        gradedAt: true,
        enrollmentId: true,
        gradedBy: { select: { id: true, name: true, email: true } },
        answers: { select: { needsReview: true, textAnswer: true } },
        enrollment: {
          select: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
            batch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: view === "pending" ? [{ submittedAt: "asc" }] : [{ gradedAt: "desc" }],
      take: 300,
    });
  },

  countGradedSince(quizIds: string[], since: Date, batchId?: string) {
    if (quizIds.length === 0) {
      return Promise.resolve(0);
    }
    return prisma.assessmentAttempt.count({
      where: {
        quizId: { in: quizIds },
        needsReview: false,
        gradedAt: { gte: since },
        ...(batchId ? { enrollment: { batchId } } : {}),
      },
    });
  },

  countPendingReviewForPrograms(programIds: string[], batchId?: string) {
    if (programIds.length === 0) {
      return Promise.resolve(0);
    }
    return prisma.assessmentAttempt.count({
      where: {
        needsReview: true,
        status: { in: [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.TIMED_OUT] },
        ...(batchId ? { enrollment: { batchId } } : {}),
        quiz: {
          OR: [
            { programId: { in: programIds } },
            { week: { programId: { in: programIds } } },
            { day: { week: { programId: { in: programIds } } } },
          ],
        },
      },
    });
  },

  async countPendingReviewByQuiz(quizIds: string[], batchId?: string) {
    const counts = new Map<string, number>();
    if (quizIds.length === 0) {
      return counts;
    }
    const rows = await prisma.assessmentAttempt.groupBy({
      by: ["quizId"],
      where: {
        quizId: { in: quizIds },
        needsReview: true,
        ...(batchId ? { enrollment: { batchId } } : {}),
      },
      _count: { _all: true },
    });
    for (const row of rows) {
      counts.set(row.quizId, row._count._all);
    }
    return counts;
  },

  findAnswerRelease(quizId: string, batchId: string) {
    return prisma.quizBatchAnswerRelease.findUnique({
      where: { quizId_batchId: { quizId, batchId } },
    });
  },

  upsertAnswerRelease(input: {
    quizId: string;
    batchId: string;
    answersVisible: boolean;
    revealedByUserId: string | null;
  }) {
    const revealedAt = input.answersVisible ? new Date() : null;
    return prisma.quizBatchAnswerRelease.upsert({
      where: { quizId_batchId: { quizId: input.quizId, batchId: input.batchId } },
      create: {
        quizId: input.quizId,
        batchId: input.batchId,
        answersVisible: input.answersVisible,
        revealedAt,
        revealedByUserId: input.answersVisible ? input.revealedByUserId : null,
      },
      update: {
        answersVisible: input.answersVisible,
        revealedAt,
        revealedByUserId: input.answersVisible ? input.revealedByUserId : null,
      },
    });
  },
};
