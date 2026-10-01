import {
  AssessmentAttemptStatus,
  QuestionType,
  type AssessmentAttempt,
  type Question,
  type QuestionOption,
} from "../generated/prisma";
import { prisma } from "../config/prisma";
import { assessmentRepository } from "../repositories/assessment.repository";
import { announcementRepository } from "../repositories/engagement.repository";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programService } from "./program.service";
import { progressService } from "./progress.service";
import { resolveTrainerWorkScope } from "./trainer-scope";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";

const DEADLINE_GRACE_MS = 5_000;

type SnapshotItem = {
  questionId: string;
  optionIds: string[];
};

type AnswerInput = {
  questionId: string;
  optionIds?: string[];
  text?: string;
};

type GradeInput = {
  questionId: string;
  pointsAwarded: number;
  comment?: string;
};

type StoredAnswer = {
  questionId: string;
  selectedOptionIds: string[];
  textAnswer?: string;
  isCorrect: boolean;
  pointsAwarded: number;
  needsReview?: boolean;
  trainerComment?: string;
};

type QuizRecord = NonNullable<Awaited<ReturnType<typeof assessmentRepository.findQuiz>>>;
type QuizLocation = {
  programId: string | null;
  program?: { title: string; createdByUserId?: string } | null;
  week?: { programId: string; title?: string; program?: { title: string; createdByUserId?: string } | null } | null;
  day?: {
    title?: string;
    week: { programId: string; title?: string; program?: { title: string; createdByUserId?: string } | null };
  } | null;
  milestone?: { programId: string; title?: string; program?: { title: string; createdByUserId?: string } | null } | null;
};

type RevealQuiz = {
  id: string;
  title: string;
  revealMode: "HIDDEN" | "IMMEDIATE" | "SCHEDULED";
  revealAt: Date | null;
  answersRevealedAnnouncedAt: Date | null;
};

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const set = new Set(left);
  return right.every((id) => set.has(id));
}

function programIdFromQuiz(quiz: QuizLocation): string {
  const programId =
    quiz.programId ?? quiz.week?.programId ?? quiz.day?.week.programId ?? quiz.milestone?.programId;
  if (!programId) {
    throw ApiError.notFound("Assessment not found");
  }
  return programId;
}

function programTitleFromQuiz(quiz: QuizLocation): string {
  return (
    quiz.program?.title ??
    quiz.week?.program?.title ??
    quiz.day?.week.program?.title ??
    quiz.milestone?.program?.title ??
    ""
  );
}

function programOwnerIdFromQuiz(quiz: QuizLocation): string | null {
  return (
    quiz.program?.createdByUserId ??
    quiz.week?.program?.createdByUserId ??
    quiz.day?.week.program?.createdByUserId ??
    quiz.milestone?.program?.createdByUserId ??
    null
  );
}

/** Trainees see score only until a later per-batch answer release. */
const TRAINEE_ANSWER_REVIEW_ENABLED = false;

function answersVisibleToTrainee(quiz: Pick<RevealQuiz, "revealMode" | "revealAt">, now = new Date()) {
  if (!TRAINEE_ANSWER_REVIEW_ENABLED) {
    return false;
  }
  if (quiz.revealMode === "HIDDEN") {
    return false;
  }
  if (quiz.revealMode === "IMMEDIATE") {
    return true;
  }
  return Boolean(quiz.revealAt && now.getTime() >= quiz.revealAt.getTime());
}

async function maybeAnnounceAnswersRevealed(quiz: RevealQuiz & QuizLocation) {
  if (quiz.revealMode !== "SCHEDULED" || quiz.answersRevealedAnnouncedAt) {
    return;
  }
  if (!answersVisibleToTrainee(quiz)) {
    return;
  }

  const programId = programIdFromQuiz(quiz);
  let createdByUserId = programOwnerIdFromQuiz(quiz);
  let programTitle = programTitleFromQuiz(quiz);
  if (!createdByUserId || !programTitle) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { createdByUserId: true, title: true },
    });
    createdByUserId = createdByUserId ?? program?.createdByUserId ?? null;
    programTitle = programTitle || program?.title || "";
  }
  if (!createdByUserId) {
    return;
  }

  const claimed = await prisma.quiz.updateMany({
    where: {
      id: quiz.id,
      revealMode: "SCHEDULED",
      answersRevealedAnnouncedAt: null,
    },
    data: { answersRevealedAnnouncedAt: new Date() },
  });
  if (claimed.count === 0) {
    return;
  }

  const when = quiz.revealAt ? quiz.revealAt.toLocaleString() : "now";
  await announcementRepository.create({
    title: `Answers available: ${quiz.title}`,
    body: `Correct answers for “${quiz.title}” in ${programTitle || "your program"} are now visible (${when}).`,
    audience: "PROGRAM",
    programId,
    createdByUserId,
  });
}

function parseSnapshot(value: unknown): SnapshotItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const row = entry as { questionId?: unknown; optionIds?: unknown };
    if (typeof row.questionId !== "string" || !Array.isArray(row.optionIds)) {
      return [];
    }
    return [
      {
        questionId: row.questionId,
        optionIds: row.optionIds.filter((id): id is string => typeof id === "string"),
      },
    ];
  });
}

function drawSize(bank: number, written: number, drawCount: number | null): number {
  if (drawCount == null || drawCount <= 0) {
    return bank;
  }
  return Math.min(bank, Math.max(drawCount, written));
}

function effectiveQuestionCount(quiz: {
  questions: Array<{ type: QuestionType }>;
  questionDrawCount: number | null;
}): number {
  return drawSize(quiz.questions.length, writtenQuestionCount(quiz), quiz.questionDrawCount);
}

function bySortOrder<T extends { sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

function buildSnapshot(
  questions: Array<Question & { options: QuestionOption[] }>,
  randomized: boolean,
  drawCount: number | null,
): SnapshotItem[] {
  const written = questions.filter((question) => question.type === QuestionType.WRITTEN);
  const choice = questions.filter((question) => question.type !== QuestionType.WRITTEN);
  const size = drawSize(questions.length, written.length, drawCount);
  const drawing = size < questions.length;
  const shuffleQuestions = randomized || drawing;
  const shuffleOptions = randomized || drawing;
  const drawnChoice = drawing ? shuffle(choice).slice(0, size - written.length) : choice;
  const pool = [...written, ...drawnChoice];
  const selected = shuffleQuestions ? shuffle(pool) : bySortOrder(pool);
  return selected.map((question) => {
    const options = shuffleOptions
      ? shuffle(question.options)
      : [...question.options].sort((a, b) => a.sortOrder - b.sortOrder);
    return { questionId: question.id, optionIds: options.map((option) => option.id) };
  });
}

function safeQuestions(
  quiz: QuizRecord,
  snapshot: SnapshotItem[],
  revealKeys: boolean,
  answers?: StoredAnswer[],
) {
  const questionMap = new Map(quiz.questions.map((question) => [question.id, question]));
  const answerMap = new Map((answers ?? []).map((answer) => [answer.questionId, answer]));

  return snapshot.flatMap((item) => {
    const question = questionMap.get(item.questionId);
    if (!question) {
      return [];
    }
    const optionMap = new Map(question.options.map((option) => [option.id, option]));
    const selected = answerMap.get(question.id);
    return [
      {
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        points: question.points,
        selectedOptionIds: selected?.selectedOptionIds ?? [],
        textAnswer: selected?.textAnswer ?? "",
        ...(revealKeys
          ? {
              isCorrect: selected?.isCorrect ?? false,
              pointsAwarded: selected?.pointsAwarded ?? 0,
              trainerComment: selected?.trainerComment ?? "",
              correctOptionIds: question.options.filter((option) => option.isCorrect).map((option) => option.id),
            }
          : {}),
        options: item.optionIds.flatMap((optionId) => {
          const option = optionMap.get(optionId);
          if (!option) {
            return [];
          }
          return [
            {
              id: option.id,
              label: option.label,
              ...(revealKeys ? { isCorrect: option.isCorrect } : {}),
            },
          ];
        }),
      },
    ];
  });
}

function percentScore(earned: number, total: number): number {
  return total === 0 ? 0 : Math.round((earned / total) * 10000) / 100;
}

/** Multiple choice is marked immediately; non-blank written answers wait for the trainer. */
function gradeAnswers(quiz: QuizRecord, snapshot: SnapshotItem[], answers: AnswerInput[]) {
  const questionMap = new Map(quiz.questions.map((question) => [question.id, question]));
  const snapshotMap = new Map(snapshot.map((item) => [item.questionId, item]));
  const submitted = new Map<string, { optionIds: string[]; text: string }>();

  for (const answer of answers) {
    if (submitted.has(answer.questionId)) {
      throw ApiError.badRequest("Duplicate answer for a question");
    }
    const snap = snapshotMap.get(answer.questionId);
    if (!snap) {
      throw ApiError.badRequest("Answer does not belong to this attempt");
    }
    const optionIds = answer.optionIds ?? [];
    const allowed = new Set(snap.optionIds);
    if (optionIds.some((id) => !allowed.has(id))) {
      throw ApiError.badRequest("Invalid option for this question");
    }
    submitted.set(answer.questionId, { optionIds: [...new Set(optionIds)], text: (answer.text ?? "").trim() });
  }

  let earned = 0;
  let total = 0;
  const graded = snapshot.map((item) => {
    const question = questionMap.get(item.questionId);
    const answer = submitted.get(item.questionId);
    if (!question) {
      return {
        questionId: item.questionId,
        selectedOptionIds: answer?.optionIds ?? [],
        textAnswer: "",
        isCorrect: false,
        pointsAwarded: 0,
        needsReview: false,
      };
    }
    total += question.points;
    if (question.type === QuestionType.WRITTEN) {
      const text = answer?.text ?? "";
      return {
        questionId: question.id,
        selectedOptionIds: [],
        textAnswer: text,
        isCorrect: false,
        pointsAwarded: 0,
        needsReview: text.length > 0,
      };
    }
    const selected = answer?.optionIds ?? [];
    const correctIds = question.options.filter((option) => option.isCorrect).map((option) => option.id);
    const isCorrect = sameSet(selected, correctIds);
    const pointsAwarded = isCorrect ? question.points : 0;
    earned += pointsAwarded;
    return {
      questionId: question.id,
      selectedOptionIds: selected,
      textAnswer: "",
      isCorrect,
      pointsAwarded,
      needsReview: false,
    };
  });

  const needsReview = graded.some((answer) => answer.needsReview);
  const score = needsReview ? null : percentScore(earned, total);
  const passed = score === null ? null : score >= quiz.passingScore;
  return { graded, score, passed, needsReview, earned, total };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function closedStatuses(status: AssessmentAttemptStatus) {
  return status === AssessmentAttemptStatus.SUBMITTED || status === AssessmentAttemptStatus.TIMED_OUT;
}

function summarizeAttempts(attempts: Array<{
  id: string;
  attemptNumber: number;
  status: AssessmentAttemptStatus;
  score: unknown;
  passed: boolean | null;
  needsReview: boolean;
  startedAt: Date;
  submittedAt: Date | null;
  deadlineAt: Date | null;
}>) {
  const history = attempts.map((attempt) => ({
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    score: toNumber(attempt.score),
    passed: attempt.passed,
    needsReview: attempt.needsReview,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    deadlineAt: attempt.deadlineAt,
  }));
  const closed = history.filter((attempt) => closedStatuses(attempt.status));
  const scores = closed.map((attempt) => attempt.score).filter((score): score is number => score !== null);
  return {
    history,
    attemptsUsed: closed.length,
    bestScore: scores.length ? Math.max(...scores) : null,
    passed: closed.some((attempt) => attempt.passed === true),
    pendingReview: closed.some((attempt) => attempt.needsReview),
    activeAttemptId: history.find((attempt) => attempt.status === AssessmentAttemptStatus.IN_PROGRESS)?.id ?? null,
  };
}

function writtenQuestionCount(quiz: { questions: Array<{ type: QuestionType }> }): number {
  return quiz.questions.filter((question) => question.type === QuestionType.WRITTEN).length;
}

function locationLabel(quiz: QuizLocation & { day?: { title: string; week: { title: string } } | null; week?: { title: string } | null; milestone?: { title: string } | null }) {
  if (quiz.day) {
    return `${quiz.day.week.title} · ${quiz.day.title}`;
  }
  if (quiz.week) {
    return quiz.week.title;
  }
  if (quiz.milestone) {
    return quiz.milestone.title;
  }
  return "Program";
}

async function requireQuiz(id: string): Promise<QuizRecord> {
  const quiz = await assessmentRepository.findQuiz(id);
  if (!quiz) {
    throw ApiError.notFound("Assessment not found");
  }
  return quiz;
}

function deadlinePassed(deadlineAt: Date | null, now = new Date()) {
  return Boolean(deadlineAt && now.getTime() > deadlineAt.getTime() + DEADLINE_GRACE_MS);
}

async function closeExpired(
  attempt: AssessmentAttempt,
  quiz: QuizRecord,
) {
  if (attempt.status !== AssessmentAttemptStatus.IN_PROGRESS || !deadlinePassed(attempt.deadlineAt)) {
    return null;
  }

  const snapshot = parseSnapshot(attempt.questionSnapshot);
  const { graded, score, passed, needsReview } = gradeAnswers(quiz, snapshot, []);
  return assessmentRepository.saveGradedAttempt({
    attemptId: attempt.id,
    status: AssessmentAttemptStatus.TIMED_OUT,
    score,
    passed,
    needsReview,
    answers: graded,
  });
}

function toAttemptPayload(
  quiz: QuizRecord,
  attempt: {
    id: string;
    attemptNumber: number;
    status: AssessmentAttemptStatus;
    startedAt: Date;
    deadlineAt: Date | null;
    submittedAt: Date | null;
    score: unknown;
    passed: boolean | null;
    needsReview?: boolean;
    gradedAt?: Date | null;
    questionSnapshot: unknown;
    answers?: StoredAnswer[];
  },
  closed: boolean,
  revealKeys: boolean,
) {
  const snapshot = parseSnapshot(attempt.questionSnapshot);
  const questions = safeQuestions(quiz, snapshot, revealKeys, attempt.answers);
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt,
    score: closed ? toNumber(attempt.score) : null,
    passed: closed ? attempt.passed : null,
    needsReview: closed ? Boolean(attempt.needsReview) : false,
    gradedAt: attempt.gradedAt ?? null,
    passingScore: quiz.passingScore,
    answersVisible: revealKeys,
    questions:
      closed && !revealKeys
        ? questions.map((question) => ({
            id: question.id,
            type: question.type,
            prompt: question.prompt,
            points: question.points,
            selectedOptionIds: [] as string[],
            textAnswer: "",
            options: [] as Array<{ id: string; label: string }>,
          }))
        : questions,
  };
}

async function catalogForQuiz(user: AuthUser, quiz: QuizRecord) {
  await maybeAnnounceAnswersRevealed(quiz);
  const programId = programIdFromQuiz(quiz);
  const view = await progressService.getComputation(user, programId);
  const access = progressService.quizAccess(view, quiz.id);
  const attempts = await assessmentRepository.findAttemptsForEnrollment(view.enrollment.id, quiz.id);
  const open = attempts.find((row) => row.status === AssessmentAttemptStatus.IN_PROGRESS);
  if (open) {
    await closeExpired(open, quiz);
  }
  const refreshed = await assessmentRepository.findAttemptsForEnrollment(view.enrollment.id, quiz.id);
  const summary = summarizeAttempts(refreshed);
  const remaining =
    quiz.maxAttempts === null ? null : Math.max(quiz.maxAttempts - summary.attemptsUsed, 0);
  const canStart =
    access.status !== "LOCKED" &&
    quiz.questions.length > 0 &&
    (summary.activeAttemptId !== null || (!summary.pendingReview && (remaining === null || remaining > 0)));

  return {
    assessment: {
      id: quiz.id,
      kind: quiz.kind,
      title: quiz.title,
      description: quiz.description,
      passingScore: quiz.passingScore,
      timeLimitMin: quiz.timeLimitMin,
      maxAttempts: quiz.maxAttempts,
      randomized: quiz.randomized,
      questionDrawCount: quiz.questionDrawCount,
      questionCount: effectiveQuestionCount(quiz),
      questionBankCount: quiz.questions.length,
      writtenQuestionCount: writtenQuestionCount(quiz),
      revealMode: quiz.revealMode,
      revealAt: quiz.revealAt,
      answersVisible: answersVisibleToTrainee(quiz),
      programId,
      programTitle: view.program.title,
      location: locationLabel(quiz),
      status: access.status,
      reason: access.reason,
    },
    attempts: summary.history,
    attemptsUsed: summary.attemptsUsed,
    attemptsRemaining: remaining,
    bestScore: summary.bestScore,
    passed: summary.passed,
    pendingReview: summary.pendingReview,
    activeAttemptId: summary.activeAttemptId,
    canStart,
  };
}

export const assessmentService = {
  async listForTrainee(user: AuthUser) {
    const enrollments = await progressService.listSummaries(user.id);
    const assessments = [];
    for (const enrollment of enrollments) {
      const quizzes = await assessmentRepository.findQuizzesForProgram(enrollment.program.id);
      for (const quiz of quizzes) {
        assessments.push(await catalogForQuiz(user, quiz));
      }
    }
    return { assessments };
  },

  async getForTrainee(user: AuthUser, quizId: string) {
    const quiz = await requireQuiz(quizId);
    return catalogForQuiz(user, quiz);
  },

  async startAttempt(user: AuthUser, quizId: string) {
    const quiz = await requireQuiz(quizId);
    const catalog = await catalogForQuiz(user, quiz);
    const programId = programIdFromQuiz(quiz);
    const view = await progressService.getComputation(user, programId);

    if (catalog.assessment.status === "LOCKED") {
      throw new ApiError(403, catalog.assessment.reason ?? "This assessment is locked", "CONTENT_LOCKED");
    }
    if (quiz.questions.length === 0) {
      throw ApiError.badRequest("This assessment has no questions");
    }

    const open = await assessmentRepository.findOpenAttempt(view.enrollment.id, quiz.id);
    if (open) {
      const timedOut = await closeExpired(open, quiz);
      if (!timedOut) {
        return { created: false, attempt: toAttemptPayload(quiz, open, false, false) };
      }
    }

    if (catalog.pendingReview) {
      throw new ApiError(
        403,
        "Your last attempt is waiting for your trainer to grade it. You can try again once it's graded.",
        "PENDING_REVIEW",
      );
    }

    const used = await assessmentRepository.countClosedAttempts(view.enrollment.id, quiz.id);
    if (quiz.maxAttempts !== null && used >= quiz.maxAttempts) {
      throw new ApiError(403, "No attempts remaining", "MAX_ATTEMPTS");
    }

    const startedAt = new Date();
    const deadlineAt = quiz.timeLimitMin
      ? new Date(startedAt.getTime() + quiz.timeLimitMin * 60_000)
      : null;
    const attemptNumber = await assessmentRepository.nextAttemptNumber(view.enrollment.id, quiz.id);
    const created = await assessmentRepository.createAttempt({
      enrollmentId: view.enrollment.id,
      quizId: quiz.id,
      attemptNumber,
      deadlineAt,
      questionSnapshot: buildSnapshot(quiz.questions, quiz.randomized, quiz.questionDrawCount),
    });

    return { created: true, attempt: toAttemptPayload(quiz, created, false, false) };
  },

  async getAttempt(user: AuthUser, attemptId: string) {
    const attempt = await assessmentRepository.findAttempt(attemptId);
    if (!attempt || attempt.enrollment.userId !== user.id) {
      throw ApiError.notFound("Attempt not found");
    }

    const timedOut = await closeExpired(attempt, attempt.quiz);
    const current = timedOut ?? attempt;
    const closed = closedStatuses(current.status);
    await maybeAnnounceAnswersRevealed(attempt.quiz);
    const revealKeys = closed && answersVisibleToTrainee(attempt.quiz);
    return { attempt: toAttemptPayload(attempt.quiz, current, closed, revealKeys) };
  },

  async submitAttempt(user: AuthUser, attemptId: string, answers: AnswerInput[]) {
    const attempt = await assessmentRepository.findAttempt(attemptId);
    if (!attempt || attempt.enrollment.userId !== user.id) {
      throw ApiError.notFound("Attempt not found");
    }

    if (closedStatuses(attempt.status)) {
      throw ApiError.badRequest("This attempt is already closed");
    }

    const expired = deadlinePassed(attempt.deadlineAt);
    const snapshot = parseSnapshot(attempt.questionSnapshot);
    const { graded, score, passed, needsReview } = gradeAnswers(attempt.quiz, snapshot, expired ? [] : answers);
    const saved = await assessmentRepository.saveGradedAttempt({
      attemptId: attempt.id,
      status: expired ? AssessmentAttemptStatus.TIMED_OUT : AssessmentAttemptStatus.SUBMITTED,
      score,
      passed,
      needsReview,
      answers: graded,
    });

    await progressService.getComputation(user, programIdFromQuiz(attempt.quiz));
    await maybeAnnounceAnswersRevealed(attempt.quiz);
    const closed = true;
    const revealKeys = answersVisibleToTrainee(attempt.quiz);

    return {
      attempt: toAttemptPayload(attempt.quiz, { ...attempt, ...saved }, closed, revealKeys),
    };
  },

  async listForTrainer(user: AuthUser, programIdRaw?: unknown, batchIdRaw?: unknown) {
    const scope = await resolveTrainerWorkScope(user, programIdRaw, batchIdRaw);
    const quizzes = await assessmentRepository.findQuizzesForTrainer(scope.programIds);
    const attemptCounts = scope.batchId
      ? await assessmentRepository.countAttemptsByQuiz(
          quizzes.map((quiz) => quiz.id),
          scope.batchId,
        )
      : null;
    const pendingCounts = await assessmentRepository.countPendingReviewByQuiz(
      quizzes.map((quiz) => quiz.id),
      scope.batchId,
    );
    return {
      assessments: quizzes.map((quiz) => {
        const programId = programIdFromQuiz(quiz);
        return {
          id: quiz.id,
          kind: quiz.kind,
          title: quiz.title,
          description: quiz.description,
          passingScore: quiz.passingScore,
          timeLimitMin: quiz.timeLimitMin,
          maxAttempts: quiz.maxAttempts,
          randomized: quiz.randomized,
          questionDrawCount: quiz.questionDrawCount,
          questionCount: drawSize(quiz._count.questions, writtenQuestionCount(quiz), quiz.questionDrawCount),
          questionBankCount: quiz._count.questions,
          writtenQuestionCount: writtenQuestionCount(quiz),
          attemptCount: attemptCounts ? (attemptCounts.get(quiz.id) ?? 0) : quiz._count.attempts,
          pendingReviewCount: pendingCounts.get(quiz.id) ?? 0,
          programId,
          programTitle: programTitleFromQuiz(quiz),
          location: locationLabel(quiz),
        };
      }),
    };
  },

  async gradingQueue(user: AuthUser, programIdRaw?: unknown, viewRaw?: unknown) {
    const view = viewRaw === "graded" ? "graded" : "pending";
    const scope = await resolveTrainerWorkScope(user, programIdRaw);
    const quizzes = await assessmentRepository.findQuizzesForTrainer(scope.programIds);
    const quizById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));
    const quizIds = quizzes.map((quiz) => quiz.id);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [rows, pending, gradedThisWeek] = await Promise.all([
      assessmentRepository.findGradingQueue(quizIds, view, view === "graded" ? weekAgo : undefined),
      assessmentRepository.countPendingReviewForPrograms(scope.programIds),
      assessmentRepository.countGradedSince(quizIds, weekAgo),
    ]);

    const items = rows.flatMap((row) => {
      const quiz = quizById.get(row.quizId);
      if (!quiz) {
        return [];
      }
      const writtenAnswers = row.answers.filter((answer) => answer.textAnswer !== null);
      return [
        {
          attemptId: row.id,
          attemptNumber: row.attemptNumber,
          status: row.status,
          score: toNumber(row.score),
          passed: row.passed,
          needsReview: row.needsReview,
          submittedAt: row.submittedAt,
          gradedAt: row.gradedAt,
          enrollmentId: row.enrollmentId,
          pendingAnswerCount: row.answers.filter((answer) => answer.needsReview).length,
          writtenAnswerCount: writtenAnswers.length,
          trainee: row.enrollment.user,
          batch: row.enrollment.batch,
          quiz: {
            id: quiz.id,
            title: quiz.title,
            kind: quiz.kind,
            passingScore: quiz.passingScore,
            location: locationLabel(quiz),
          },
          programId: programIdFromQuiz(quiz),
          programTitle: programTitleFromQuiz(quiz),
        },
      ];
    });

    const oldestPendingAt =
      view === "pending" ? (items.find((item) => item.submittedAt)?.submittedAt ?? null) : null;

    return {
      view,
      items,
      summary: { pending, gradedThisWeek, oldestPendingAt },
    };
  },

  async gradingCount(user: AuthUser) {
    const programIds = await programService.listProgramIdsForTrainer(user.id);
    return { pending: await assessmentRepository.countPendingReviewForPrograms(programIds) };
  },

  async getForTrainer(user: AuthUser, quizId: string, programIdRaw?: unknown, batchIdRaw?: unknown) {
    const quiz = await requireQuiz(quizId);
    const programId = programIdFromQuiz(quiz);
    const scope = await resolveTrainerWorkScope(user, programIdRaw, batchIdRaw);
    if (!scope.programIds.includes(programId)) {
      throw ApiError.forbidden();
    }
    if (scope.programId && scope.programId !== programId) {
      throw ApiError.badRequest("Assessment does not belong to that course");
    }
    await programService.requireTrainerOnProgram(user, programId);
    await maybeAnnounceAnswersRevealed(quiz);
    const attempts = await assessmentRepository.findAttemptsForQuiz(quiz.id, scope.batchId);
    const enrollments = await enrollmentRepository.findRoster(programId, scope.batchId);
    const byEnrollment = new Map<string, typeof attempts>();
    for (const row of attempts) {
      const list = byEnrollment.get(row.enrollmentId) ?? [];
      list.push(row);
      byEnrollment.set(row.enrollmentId, list);
    }

    const roster = enrollments.map((enrollment) => {
      const traineeAttempts = [...(byEnrollment.get(enrollment.id) ?? [])].sort(
        (a, b) => b.attemptNumber - a.attemptNumber,
      );
      const latestClosed = traineeAttempts.find((row) => closedStatuses(row.status)) ?? null;
      const latest = latestClosed ?? traineeAttempts[0] ?? null;
      return {
        enrollmentId: enrollment.id,
        trainee: enrollment.user,
        traineeId: enrollment.userId,
        batch: enrollment.batch,
        status: latest ? latest.status : ("NOT_STARTED" as const),
        latest: latest
          ? {
              id: latest.id,
              attemptNumber: latest.attemptNumber,
              status: latest.status,
              score: toNumber(latest.score),
              passed: latest.passed,
              needsReview: latest.needsReview,
              gradedAt: latest.gradedAt,
              startedAt: latest.startedAt,
              submittedAt: latest.submittedAt,
              answers: latest.answers,
            }
          : null,
        attempts: traineeAttempts.map((row) => ({
          id: row.id,
          attemptNumber: row.attemptNumber,
          status: row.status,
          score: toNumber(row.score),
          passed: row.passed,
          needsReview: row.needsReview,
          startedAt: row.startedAt,
          submittedAt: row.submittedAt,
        })),
      };
    });

    const closedLatest = roster
      .map((row) => row.latest)
      .filter((row): row is NonNullable<(typeof roster)[number]["latest"]> => Boolean(row && closedStatuses(row.status)));
    const gradedLatest = closedLatest.filter((row) => !row.needsReview);
    const scores = gradedLatest.map((row) => row.score).filter((score): score is number => score !== null);
    const submittedCount = closedLatest.length;
    const needsReviewCount = closedLatest.length - gradedLatest.length;
    const inProgressCount = roster.filter((row) => row.status === AssessmentAttemptStatus.IN_PROGRESS).length;
    const notStartedCount = roster.filter((row) => row.latest === null).length;

    return {
      assessment: {
        id: quiz.id,
        kind: quiz.kind,
        title: quiz.title,
        description: quiz.description,
        passingScore: quiz.passingScore,
        timeLimitMin: quiz.timeLimitMin,
        maxAttempts: quiz.maxAttempts,
        randomized: quiz.randomized,
        questionDrawCount: quiz.questionDrawCount,
        questionCount: effectiveQuestionCount(quiz),
        questionBankCount: quiz.questions.length,
        writtenQuestionCount: writtenQuestionCount(quiz),
        revealMode: quiz.revealMode,
        revealAt: quiz.revealAt,
        attemptCount: attempts.length,
        programId,
        programTitle: programTitleFromQuiz(quiz),
        location: locationLabel(quiz),
        questions: quiz.questions.map((question) => ({
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          points: question.points,
          modelAnswer: question.modelAnswer,
          options: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            isCorrect: option.isCorrect,
          })),
        })),
      },
      summary: {
        rosterCount: roster.length,
        submittedCount,
        needsReviewCount,
        inProgressCount,
        notStartedCount,
        averageScore: scores.length
          ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
          : null,
        passRate:
          gradedLatest.length === 0
            ? null
            : Math.round((gradedLatest.filter((row) => row.passed === true).length / gradedLatest.length) * 10000) / 100,
      },
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        score: toNumber(attempt.score),
        passed: attempt.passed,
        needsReview: attempt.needsReview,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        enrollmentId: attempt.enrollmentId,
        trainee: attempt.enrollment.user,
        batch: attempt.enrollment.batch,
        answers: attempt.answers,
      })),
      roster,
    };
  },

  async gradeAttempt(user: AuthUser, attemptId: string, grades: GradeInput[]) {
    const attempt = await assessmentRepository.findAttempt(attemptId);
    if (!attempt) {
      throw ApiError.notFound("Attempt not found");
    }
    const programId = programIdFromQuiz(attempt.quiz);
    await programService.requireTrainerOnProgram(user, programId);
    if (!closedStatuses(attempt.status)) {
      throw ApiError.badRequest("This attempt hasn't been submitted yet.");
    }

    const questionMap = new Map(attempt.quiz.questions.map((question) => [question.id, question]));
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    const updates = new Map<string, { questionId: string; pointsAwarded: number; isCorrect: boolean; comment: string }>();
    for (const grade of grades) {
      if (updates.has(grade.questionId)) {
        throw ApiError.badRequest("Each question can only be graded once per save.");
      }
      const question = questionMap.get(grade.questionId);
      if (!question || !answerMap.has(grade.questionId)) {
        throw ApiError.badRequest("That question is not part of this attempt.");
      }
      if (question.type !== QuestionType.WRITTEN) {
        throw ApiError.badRequest("Only written answers are graded by hand.");
      }
      if (grade.pointsAwarded > question.points) {
        throw ApiError.badRequest(`A question is worth at most ${question.points} points.`);
      }
      updates.set(grade.questionId, {
        questionId: grade.questionId,
        pointsAwarded: grade.pointsAwarded,
        isCorrect: grade.pointsAwarded === question.points,
        comment: (grade.comment ?? "").trim(),
      });
    }

    let earned = 0;
    let total = 0;
    let stillPending = false;
    for (const item of parseSnapshot(attempt.questionSnapshot)) {
      const question = questionMap.get(item.questionId);
      if (!question) {
        continue;
      }
      total += question.points;
      const update = updates.get(item.questionId);
      const answer = answerMap.get(item.questionId);
      earned += update ? update.pointsAwarded : (answer?.pointsAwarded ?? 0);
      if (!update && answer?.needsReview) {
        stillPending = true;
      }
    }
    const score = stillPending ? null : percentScore(earned, total);
    const passed = score === null ? null : score >= attempt.quiz.passingScore;
    const regrade = !attempt.needsReview;

    const saved = await assessmentRepository.saveTrainerGrades({
      attemptId: attempt.id,
      gradedByUserId: user.id,
      grades: [...updates.values()],
      score,
      passed,
      needsReview: stillPending,
    });

    await progressService.recomputeEnrollment(attempt.enrollmentId);

    if (score !== null) {
      const programTitle = programTitleFromQuiz(attempt.quiz);
      await announcementRepository.create({
        title: `${regrade ? "Grade updated" : "Graded"}: ${attempt.quiz.title}`,
        body: `Your trainer ${regrade ? "updated the grade for" : "graded"} “${attempt.quiz.title}”${
          programTitle ? ` in ${programTitle}` : ""
        }. Your score is ${score}% (${passed ? "passed" : `pass mark ${attempt.quiz.passingScore}%`}).`,
        audience: "TRAINEES_SELECTED",
        programId,
        batchId: attempt.enrollment.batchId,
        createdByUserId: user.id,
        traineeIds: [attempt.enrollment.userId],
      });
    }

    return {
      attempt: {
        id: saved.id,
        score: toNumber(saved.score),
        passed: saved.passed,
        needsReview: saved.needsReview,
        gradedAt: saved.gradedAt,
        answers: saved.answers,
      },
    };
  },
};
