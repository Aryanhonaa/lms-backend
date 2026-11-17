import { describe, expect, it } from "vitest";
import {
  addDays,
  quizCanRetry,
  quizClearsProgressionGate,
  scheduledOpensAt,
  unlockService,
  type AccessResult,
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
  passed: false,
  failed: false,
  bestScore: null,
  lastSubmittedAt: null,
  attemptsUsed: 0,
};

const passed: QuizAttemptState = {
  inProgress: false,
  passed: true,
  failed: false,
  bestScore: 80,
  lastSubmittedAt: new Date(),
  attemptsUsed: 1,
};

function failed(attemptsUsed: number): QuizAttemptState {
  return {
    inProgress: false,
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

describe("scheduled day unlock", () => {
  const openWeek: AccessResult = { status: "AVAILABLE", available: true, reason: null };
  const start = new Date(Date.UTC(2026, 10, 17));

  it("opens day 1 on the start date and day 2 the next calendar day", () => {
    const midday = new Date(Date.UTC(2026, 10, 17, 12));
    expect(scheduledOpensAt(start, 0)?.toISOString()).toBe(start.toISOString());
    expect(scheduledOpensAt(start, 1)?.toISOString()).toBe(addDays(start, 1).toISOString());

    const day1 = unlockService.dayAccess("SCHEDULED", openWeek, true, null, start, 0, midday);
    const day2 = unlockService.dayAccess("SCHEDULED", openWeek, true, "Day 1", start, 1, midday);
    expect(day1.status).toBe("AVAILABLE");
    expect(day2.status).toBe("LOCKED");
    expect(day2.reason).toMatch(/opens on/i);
  });

  it("lets progression open the next day as soon as the previous day is complete", () => {
    const sameDay = new Date(Date.UTC(2026, 10, 17, 18));
    const waiting = unlockService.dayAccess("PROGRESSION", openWeek, false, "Day 1", start, 1, sameDay);
    const ready = unlockService.dayAccess("PROGRESSION", openWeek, true, "Day 1", start, 1, sameDay);
    expect(waiting.status).toBe("LOCKED");
    expect(ready.status).toBe("AVAILABLE");
  });
});
