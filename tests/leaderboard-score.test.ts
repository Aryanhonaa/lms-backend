import { describe, expect, it } from "vitest";
import { blendLeaderboardScore } from "../src/utils/leaderboard-score";

describe("leaderboard blend", () => {
  it("does not rank by progress alone and drops empty components", () => {
    const progressOnly = blendLeaderboardScore({
      progress: 90,
      quiz: 0,
      exam: 0,
      milestone: null,
    });
    const balanced = blendLeaderboardScore({
      progress: 40,
      quiz: 100,
      exam: 100,
      milestone: null,
    });

    expect(progressOnly.score).toBeLessThan(balanced.score);
    expect(progressOnly.weights.milestone).toBe(0);
    expect(progressOnly.weights.quiz).toBe(0.2);

    const noQuizExam = blendLeaderboardScore({
      progress: 50,
      quiz: null,
      exam: 100,
      milestone: null,
    });
    expect(noQuizExam.weights.quiz).toBe(0);
    expect(noQuizExam.score).toBe(73.08);
  });
});
