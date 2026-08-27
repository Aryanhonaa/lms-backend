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
  milestoneId: string | null;
  programId: string | null;
}>(quiz: T) {
  const [day, week, milestone, program] = await Promise.all([
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
    quiz.milestoneId
      ? prisma.milestone.findUnique({
          where: { id: quiz.milestoneId },
          include: { program: true },
        })
      : Promise.resolve(null),
    quiz.programId ? prisma.program.findUnique({ where: { id: quiz.programId } }) : Promise.resolve(null),
  ]);

  return { ...quiz, day, week, milestone, program };
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
          { milestone: { programId } },
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
          { milestone: { programId: { in: programIds } } },
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
    score: number;
    passed: boolean;
    answers: Array<{
      questionId: string;
      selectedOptionIds: string[];
      isCorrect: boolean;
      pointsAwarded: number;
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
            isCorrect: answer.isCorrect,
            pointsAwarded: answer.pointsAwarded,
          })),
        });
      }

      return tx.assessmentAttempt.update({
        where: { id: input.attemptId },
        data: {
          status: input.status,
          score: input.score,
          passed: input.passed,
          submittedAt: new Date(),
        },
        include: { answers: true },
      });
    });
  },
};
