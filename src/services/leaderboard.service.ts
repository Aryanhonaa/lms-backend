import { AchievementKey, EnrollmentStatus, QuizKind } from "../generated/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programBatchRepository } from "../repositories/program-batch.repository";
import { programRepository } from "../repositories/program.repository";
import { enrollmentService } from "./enrollment.service";
import { programService } from "./program.service";
import { progressService } from "./progress.service";
import { quizState, type ProgramTree, type TraineeFacts } from "./unlock.service";
import { achievementRepository } from "../repositories/engagement.repository";
import type { AuthUser } from "../types";
import { blendLeaderboardScore, roundScore } from "../utils/leaderboard-score";
import { ApiError } from "../utils/api-error";

const QUIZ_KINDS: QuizKind[] = [QuizKind.PRACTICE_QUIZ, QuizKind.WEEKLY_QUIZ];
const EXAM_KINDS: QuizKind[] = [QuizKind.WEEKLY_EXAM, QuizKind.MILESTONE_EXAM, QuizKind.FINAL_EXAM];

export type PublicLeaderboardEntry = {
  rank: number;
  trainee: { id: string; name: string };
  score: number;
  progressPercent: number;
  quizzesPassed: number;
  quizzesTotal: number;
  examsPassed: number;
  examsTotal: number;
  milestonesComplete: number;
  milestonesTotal: number;
};

function collectQuizzes(program: ProgramTree) {
  const rows = [
    ...program.quizzes,
    ...program.weeks.flatMap((week) => week.quizzes),
    ...program.weeks.flatMap((week) => week.days.flatMap((day) => day.quizzes)),
    ...program.milestones.flatMap((milestone) => (milestone.exam ? [milestone.exam] : [])),
  ];
  const seen = new Set<string>();
  return rows.filter((quiz) => {
    if (seen.has(quiz.id)) {
      return false;
    }
    seen.add(quiz.id);
    return true;
  });
}

function meanBest(quizzes: Array<{ id: string }>, facts: TraineeFacts): number | null {
  if (quizzes.length === 0) {
    return null;
  }
  const sum = quizzes.reduce((total, quiz) => total + (quizState(facts, quiz.id).bestScore ?? 0), 0);
  return roundScore(sum / quizzes.length);
}

function passedCount(quizzes: Array<{ id: string }>, facts: TraineeFacts): number {
  return quizzes.filter((quiz) => quizState(facts, quiz.id).passed).length;
}

function publicEntry(row: {
  rank: number;
  userId: string;
  name: string;
  score: number;
  progressPercent: number;
  quizzesPassed: number;
  quizzesTotal: number;
  examsPassed: number;
  examsTotal: number;
  milestonesComplete: number;
  milestonesTotal: number;
}): PublicLeaderboardEntry {
  return {
    rank: row.rank,
    trainee: { id: row.userId, name: row.name },
    score: row.score,
    progressPercent: row.progressPercent,
    quizzesPassed: row.quizzesPassed,
    quizzesTotal: row.quizzesTotal,
    examsPassed: row.examsPassed,
    examsTotal: row.examsTotal,
    milestonesComplete: row.milestonesComplete,
    milestonesTotal: row.milestonesTotal,
  };
}

async function computeBoard(programId: string, batchId: string) {
  const program = await programRepository.findTreeById(programId);
  if (!program) {
    throw ApiError.notFound("Program not found");
  }

  const batch = await programBatchRepository.findById(batchId);
  if (!batch || batch.programId !== programId) {
    throw ApiError.notFound("Batch not found");
  }
  const batchFilter = { id: batch.id, name: batch.name };

  const [enrollments, batches] = await Promise.all([
    enrollmentRepository.findFactsByProgram(programId, batch.id),
    programBatchRepository.listForProgram(programId),
  ]);
  const quizzes = collectQuizzes(program);
  const quizItems = quizzes.filter((quiz) => QUIZ_KINDS.includes(quiz.kind));
  const examItems = quizzes.filter((quiz) => EXAM_KINDS.includes(quiz.kind));

  const scored = enrollments.map((enrollment) => {
    const facts = progressService.factsFromEnrollment(enrollment);
    const view = progressService.compute(program, enrollment.id, facts);
    const progress = view.progress.percent;
    const quiz = meanBest(quizItems, facts);
    const exam = meanBest(examItems, facts);
    const milestone =
      program.milestones.length === 0
        ? null
        : roundScore((view.milestones.filter((item) => item.satisfied).length / program.milestones.length) * 100);
    const blend = blendLeaderboardScore({ progress, quiz, exam, milestone });

    return {
      enrollmentId: enrollment.id,
      userId: enrollment.userId,
      name: enrollment.user.name,
      batchId: enrollment.batch?.id ?? batch.id,
      batchName: enrollment.batch?.name ?? batch.name,
      score: blend.score,
      progressPercent: progress,
      quiz,
      exam,
      milestone,
      weights: blend.weights,
      quizzesPassed: passedCount(quizItems, facts),
      quizzesTotal: quizItems.length,
      examsPassed: passedCount(examItems, facts),
      examsTotal: examItems.length,
      milestonesComplete: view.milestones.filter((item) => item.satisfied).length,
      milestonesTotal: program.milestones.length,
    };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.progressPercent !== left.progressPercent) {
      return right.progressPercent - left.progressPercent;
    }
    return left.name.localeCompare(right.name);
  });

  const ranked: Array<(typeof scored)[number] & { rank: number }> = [];
  for (let index = 0; index < scored.length; index += 1) {
    const row = scored[index];
    const previous = ranked[index - 1];
    const rank =
      previous && previous.score === row.score && previous.progressPercent === row.progressPercent
        ? previous.rank
        : index + 1;
    ranked.push({ ...row, rank });
  }

  if (ranked.length >= 2) {
    await achievementRepository.ensureCatalog();
    for (const row of ranked.filter((item) => item.rank === 1)) {
      await achievementRepository.grant(row.userId, AchievementKey.TOP_PERFORMER, row.enrollmentId);
    }
  }

  return {
    program: { id: program.id, title: program.title },
    batch: batchFilter,
    batches: batches.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: row._count.enrollments,
    })),
    ranked,
  };
}

function toPayload(board: Awaited<ReturnType<typeof computeBoard>>, viewerUserId?: string) {
  const entries = board.ranked.map(publicEntry);
  const mine = viewerUserId ? board.ranked.find((row) => row.userId === viewerUserId) : undefined;
  const viewerRow = viewerUserId ? board.ranked.find((row) => row.userId === viewerUserId) : undefined;

  return {
    program: board.program,
    batch: board.batch,
    batches: board.batches,
    yourBatch: viewerRow?.batchId ? { id: viewerRow.batchId, name: viewerRow.batchName ?? "Batch" } : null,
    you: mine
      ? {
          ...publicEntry(mine),
          breakdown: {
            progress: mine.progressPercent,
            quiz: mine.quiz,
            exam: mine.exam,
            milestone: mine.milestone,
            weights: mine.weights,
          },
        }
      : null,
    entries,
  };
}

export const leaderboardService = {
  async forTrainee(user: AuthUser, programId?: string, batchId?: string) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    await enrollmentService.ensureVisibleEnrollments(user.id);
    const enrollments = await enrollmentRepository.findByUser(user.id);
    let visible = enrollments.filter((row) => row.status !== EnrollmentStatus.WITHDRAWN && row.batch);

    if (programId) {
      visible = visible.filter((row) => row.programId === programId);
    }
    if (batchId) {
      visible = visible.filter((row) => row.batch?.id === batchId);
    }
    if (programId && visible.length === 0) {
      throw ApiError.notFound("Enrollment not found");
    }
    if (batchId && visible.length === 0) {
      throw ApiError.notFound("Batch not found");
    }

    const boards = [];
    for (const enrollment of visible) {
      boards.push(toPayload(await computeBoard(enrollment.programId, enrollment.batch!.id), user.id));
    }
    return { boards };
  },

  async forTrainer(user: AuthUser, programId?: string, batchId?: string) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    const programs = await programService.listForTrainer(user.id);
    const programIds = programId ? [programId] : programs.map((row) => row.id);
    if (programId) {
      await programService.requireTrainerOnProgram(user, programId);
    }

    const boards = [];
    for (const id of programIds) {
      const batches = await programBatchRepository.listForProgram(id);
      const selected = batchId && programId ? batches.filter((row) => row.id === batchId) : batches;
      if (batchId && programId && selected.length === 0) {
        throw ApiError.notFound("Batch not found");
      }
      for (const batch of selected) {
        boards.push(toPayload(await computeBoard(id, batch.id)));
      }
    }
    return { boards };
  },

  async forAdmin(user: AuthUser, programId?: string, batchId?: string) {
    if (user.role !== "SUPER_ADMIN") {
      throw ApiError.forbidden();
    }
    if (!programId) {
      const programs = await programRepository.findCatalog();
      const boards = [];
      for (const program of programs.slice(0, 20)) {
        const batches = await programBatchRepository.listForProgram(program.id);
        for (const batch of batches) {
          boards.push(toPayload(await computeBoard(program.id, batch.id)));
        }
      }
      return { boards };
    }
    if (batchId) {
      return { boards: [toPayload(await computeBoard(programId, batchId))] };
    }
    const batches = await programBatchRepository.listForProgram(programId);
    const boards = [];
    for (const batch of batches) {
      boards.push(toPayload(await computeBoard(programId, batch.id)));
    }
    return { boards };
  },
};
