export const LEADERBOARD_WEIGHTS = {
  progress: 0.4,
  quiz: 0.25,
  exam: 0.35,
} as const;

export type LeaderboardComponents = {
  progress: number;
  quiz: number | null;
  exam: number | null;
};

export type LeaderboardBlend = {
  score: number;
  weights: {
    progress: number;
    quiz: number;
    exam: number;
  };
};

export function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export function blendLeaderboardScore(parts: LeaderboardComponents): LeaderboardBlend {
  const weights = {
    progress: LEADERBOARD_WEIGHTS.progress,
    quiz: parts.quiz === null ? 0 : LEADERBOARD_WEIGHTS.quiz,
    exam: parts.exam === null ? 0 : LEADERBOARD_WEIGHTS.exam,
  };
  const totalWeight = weights.progress + weights.quiz + weights.exam;
  const raw =
    (weights.progress * parts.progress +
      weights.quiz * (parts.quiz ?? 0) +
      weights.exam * (parts.exam ?? 0)) /
    totalWeight;

  return { score: roundScore(raw), weights };
}
