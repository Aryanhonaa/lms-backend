import { describe, expect, it } from "vitest";
import { QuestionType } from "../src/generated/prisma";
import {
  quizCanRetry,
  quizClearsProgressionGate,
  quizUnblocksNextStep,
  type QuizAttemptState,
  type TraineeFacts,
} from "../src/services/unlock.service";

const quizId = "quiz-1";

function facts(state: QuizAttemptState): TraineeFacts {
  return {
    completions: new Map(),
    quizzes: new Map([[quizId, state]]),
    submissions: new Map(),
    attendancePercent: null,
  };
}

const unused: QuizAttemptState = {
  inProgress: false,
  pendingReview: false,
  passed: false,
  failed: false,
  bestScore: null,
  lastSubmittedAt: null,
  attemptsUsed: 0,
};

const passed: QuizAttemptState = {
  inProgress: false,
  pendingReview: false,
  passed: true,
  failed: false,
  bestScore: 80,
  lastSubmittedAt: new Date(),
  attemptsUsed: 1,
};

const pending: QuizAttemptState = {
  inProgress: false,
  pendingReview: true,
  passed: false,
  failed: false,
  bestScore: null,
  lastSubmittedAt: new Date(),
  attemptsUsed: 1,
};

function failed(attemptsUsed: number): QuizAttemptState {
  return {
    inProgress: false,
    pendingReview: false,
    passed: false,
    failed: true,
    bestScore: 60,
    lastSubmittedAt: new Date(),
    attemptsUsed,
  };
}

describe("quiz progression gate", () => {
  it("unlocks after a pass without treating retries as needed", () => {
    expect(quizClearsProgressionGate({ id: quizId, maxAttempts: 1 }, facts(passed))).toBe(true);
    expect(quizCanRetry(1, passed)).toBe(false);
  });

  it("keeps the next step locked when a fail still has attempts", () => {
    const state = failed(1);
    expect(quizClearsProgressionGate({ id: quizId, maxAttempts: 3 }, facts(state))).toBe(false);
    expect(quizCanRetry(3, state)).toBe(true);
  });

  it("unlocks the next step when a fail has no attempts left", () => {
    const state = failed(1);
    expect(quizClearsProgressionGate({ id: quizId, maxAttempts: 1 }, facts(state))).toBe(true);
    expect(quizCanRetry(1, state)).toBe(false);
  });

  it("unlocks after the last of several failed attempts", () => {
    const state = failed(3);
    expect(quizClearsProgressionGate({ id: quizId, maxAttempts: 3 }, facts(state))).toBe(true);
    expect(quizCanRetry(3, state)).toBe(false);
  });

  it("does not unlock when attempts are unlimited", () => {
    const state = failed(4);
    expect(quizClearsProgressionGate({ id: quizId, maxAttempts: null }, facts(state))).toBe(false);
    expect(quizCanRetry(null, state)).toBe(true);
  });

  it("does not clear the gate before the quiz is attempted", () => {
    expect(quizClearsProgressionGate({ id: quizId, maxAttempts: 1 }, facts(unused))).toBe(false);
  });
});

describe("written-answer quizzes never block the next step", () => {
  const writtenQuiz = {
    id: quizId,
    maxAttempts: 3,
    questions: [{ type: QuestionType.MULTIPLE_CHOICE }, { type: QuestionType.WRITTEN }],
  };
  const choiceOnlyQuiz = { id: quizId, maxAttempts: 3, questions: [{ type: QuestionType.MULTIPLE_CHOICE }] };

  it("lets the trainee move on while the trainer is grading", () => {
    expect(quizUnblocksNextStep(writtenQuiz, facts(pending))).toBe(true);
    expect(quizClearsProgressionGate(writtenQuiz, facts(pending))).toBe(false);
  });

  it("stays unlocked after a graded fail with retries left", () => {
    expect(quizUnblocksNextStep(writtenQuiz, facts(failed(1)))).toBe(true);
    expect(quizCanRetry(3, failed(1))).toBe(true);
  });

  it("still blocks before the first submission", () => {
    expect(quizUnblocksNextStep(writtenQuiz, facts(unused))).toBe(false);
  });

  it("keeps multiple-choice-only quizzes on the normal rule", () => {
    expect(quizUnblocksNextStep(choiceOnlyQuiz, facts(failed(1)))).toBe(false);
  });
});
