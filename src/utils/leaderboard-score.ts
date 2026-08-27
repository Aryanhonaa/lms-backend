export const LEADERBOARD_WEIGHTS = {
  progress: 0.35,
  quiz: 0.2,
  exam: 0.3,
  milestone: 0.15,
} as const;

export type LeaderboardComponents = {
  progress: number;
  quiz: number | null;
  exam: number | null;
  milestone: number | null;
};

export type LeaderboardBlend = {
  score: number;
  weights: {
    progress: number;
    quiz: number;
    exam: number;
    milestone: number;
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
    milestone: parts.milestone === null ? 0 : LEADERBOARD_WEIGHTS.milestone,
  };
  const totalWeight = weights.progress + weights.quiz + weights.exam + weights.milestone;
  const raw =
    (weights.progress * parts.progress +
      weights.quiz * (parts.quiz ?? 0) +
      weights.exam * (parts.exam ?? 0) +
      weights.milestone * (parts.milestone ?? 0)) /
    totalWeight;

  return { score: roundScore(raw), weights };
}
