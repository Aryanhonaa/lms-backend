import { AchievementKey, QuizKind } from "../generated/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programBatchRepository } from "../repositories/program-batch.repository";
import { programRepository } from "../repositories/program.repository";
import { enrollmentService } from "./enrollment.service";
import { loadFamilyRoot } from "./batch-family.service";
import { programService } from "./program.service";
import { progressService } from "./progress.service";
import { quizState, type ProgramTree, type TraineeFacts } from "./unlock.service";
import { achievementRepository } from "../repositories/engagement.repository";
import type { AuthUser } from "../types";
import { orderedBatchCourses } from "../utils/course-sequence";
import { isExitedEnrollment } from "../utils/enrollment-status";
import { blendLeaderboardScore, roundScore } from "../utils/leaderboard-score";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";

const QUIZ_KINDS: QuizKind[] = [QuizKind.PRACTICE_QUIZ, QuizKind.WEEKLY_QUIZ];
const EXAM_KINDS: QuizKind[] = [QuizKind.WEEKLY_EXAM, QuizKind.FINAL_EXAM];

export type PublicLeaderboardEntry = {
  rank: number;
  trainee: { id: string; name: string };
  score: number;
  progressPercent: number;
  quizzesPassed: number;
  quizzesTotal: number;
  examsPassed: number;
  examsTotal: number;
};

function collectQuizzes(program: ProgramTree) {
  const rows = [
    ...program.quizzes,
    ...program.weeks.flatMap((week) => week.quizzes),
    ...program.weeks.flatMap((week) => week.days.flatMap((day) => day.quizzes)),
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
  };
}

type RootBatch = NonNullable<Awaited<ReturnType<typeof programBatchRepository.findById>>>;

function familyCourses(root: RootBatch) {
  return orderedBatchCourses({
    id: root.id,
    programId: root.programId,
    sortOrder: root.sortOrder,
    createdAt: root.createdAt,
    program: root.program,
    linkedBatches: root.linkedBatches,
  });
}

async function computeBoard(programId: string, batchId: string) {
  const program = await programRepository.findTreeById(programId);
  if (!program) {
    throw ApiError.notFound("Program not found");
  }

  const member = await programBatchRepository.findById(batchId);
  if (!member || member.programId !== programId) {
    throw ApiError.notFound("Batch not found");
  }

  const root = (await loadFamilyRoot(batchId)) ?? member;
  const courses = familyCourses(root);

  const enrollments = await enrollmentRepository.findFactsByProgram(programId, member.id);
  const quizzes = collectQuizzes(program);
  const quizItems = quizzes.filter((quiz) => QUIZ_KINDS.includes(quiz.kind));
  const examItems = quizzes.filter((quiz) => EXAM_KINDS.includes(quiz.kind));

  const scored = enrollments.map((enrollment) => {
    const facts = progressService.factsFromEnrollment(enrollment);
    const view = progressService.compute(program, enrollment.id, facts);
    const progress = view.progress.percent;
    const quiz = meanBest(quizItems, facts);
    const exam = meanBest(examItems, facts);
    const blend = blendLeaderboardScore({ progress, quiz, exam });

    return {
      enrollmentId: enrollment.id,
      userId: enrollment.userId,
      name: enrollment.user.name,
      batchId: enrollment.batch?.id ?? member.id,
      batchName: enrollment.batch?.name ?? root.name,
      score: blend.score,
      progressPercent: progress,
      quiz,
      exam,
      weights: blend.weights,
      quizzesPassed: passedCount(quizItems, facts),
      quizzesTotal: quizItems.length,
      examsPassed: passedCount(examItems, facts),
      examsTotal: examItems.length,
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
    // Don't block the leaderboard response on badge writes.
    void achievementRepository.ensureCatalog().then(() =>
      Promise.all(
        ranked
          .filter((item) => item.rank === 1)
          .map((row) => achievementRepository.grant(row.userId, AchievementKey.TOP_PERFORMER, row.enrollmentId)),
      ),
    );
  }

  return {
    program: { id: program.id, title: program.title },
    batch: {
      id: root.id,
      name: root.name,
      memberCount: root._count?.enrollments,
    },
    courseBatchId: member.id,
    courses: courses.map((course) => ({
      id: course.id,
      title: course.title,
      batchId: course.batchId,
      sequence: course.sequence,
      label: course.label,
      isPrimary: course.isPrimary,
    })),
    batches: [],
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
    courseBatchId: board.courseBatchId,
    courses: board.courses,
    batches: board.batches,
    yourBatch: viewerRow?.batchId ? { id: viewerRow.batchId, name: viewerRow.batchName ?? "Batch" } : null,
    you: mine
      ? {
          ...publicEntry(mine),
          breakdown: {
            progress: mine.progressPercent,
            quiz: mine.quiz,
            exam: mine.exam,
            weights: mine.weights,
          },
        }
      : null,
    entries,
  };
}

function matchesFilters(
  course: { id: string; batchId: string },
  rootId: string,
  programId?: string,
  batchId?: string,
) {
  if (programId && course.id !== programId) {
    return false;
  }
  if (!batchId) {
    return true;
  }
  return course.batchId === batchId || rootId === batchId;
}

function filterOptionsFromRoots(roots: RootBatch[], accessibleProgramIds?: Set<string>) {
  const unique = new Map(roots.map((row) => [row.id, row]));
  const batches = [...unique.values()]
    .map((root) => {
      const courses = familyCourses(root)
        .filter((course) => (accessibleProgramIds ? accessibleProgramIds.has(course.id) : true))
        .map((course) => ({
          id: course.id,
          title: course.title,
          batchId: course.batchId,
          sequence: course.sequence,
          label: course.label,
          isPrimary: course.isPrimary,
        }));
      return {
        id: root.id,
        name: root.name,
        courses,
      };
    })
    .filter((batch) => batch.courses.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
  return { batches };
}

async function resolveTrainerRoots(userId: string) {
  const programs = await programService.listForTrainer(userId);
  const accessible = new Set(programs.map((row) => row.id));
  const nested = await Promise.all(programs.map((program) => programBatchRepository.listForProgram(program.id)));
  return { roots: nested.flat(), accessible };
}

async function resolveAdminRoots(programId?: string) {
  const programs = programId
    ? [await programRepository.findById(programId)].filter(Boolean)
    : (await programRepository.findCatalog()).slice(0, 50);
  if (programId && programs.length === 0) {
    throw ApiError.notFound("Program not found");
  }
  const nested = await Promise.all(
    programs.filter(Boolean).map((program) => programBatchRepository.listForProgram(program!.id)),
  );
  return nested.flat() as RootBatch[];
}

async function resolveTraineeRoots(userId: string) {
  await enrollmentService.ensureVisibleEnrollments(userId);
  const enrollments = await enrollmentRepository.findByUser(userId);
  const visible = enrollments.filter((row) => !isExitedEnrollment(row.status) && row.batch);
  const roots: RootBatch[] = [];
  const seen = new Set<string>();
  for (const enrollment of visible) {
    const root = await loadFamilyRoot(enrollment.batch!.id);
    if (!root || seen.has(root.id)) {
      continue;
    }
    seen.add(root.id);
    roots.push(root);
  }
  return { roots, enrollments: visible };
}

async function boardsForRootBatches(
  roots: RootBatch[],
  programId?: string,
  batchId?: string,
  viewerUserId?: string,
  accessibleProgramIds?: Set<string>,
  limit?: number,
) {
  const unique = new Map(roots.map((row) => [row.id, row]));
  const boards = [];
  for (const root of unique.values()) {
    const courses = familyCourses(root).filter((course) =>
      accessibleProgramIds ? accessibleProgramIds.has(course.id) : true,
    );
    for (const course of courses) {
      if (!matchesFilters(course, root.id, programId, batchId)) {
        continue;
      }
      boards.push(toPayload(await computeBoard(course.id, course.batchId), viewerUserId));
      if (limit != null && boards.length >= limit) {
        return boards;
      }
    }
  }
  return boards;
}

export const leaderboardService = {
  async filtersForTrainee(user: AuthUser) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    const { roots } = await resolveTraineeRoots(user.id);
    return filterOptionsFromRoots(roots);
  },

  async filtersForTrainer(user: AuthUser) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    const { roots, accessible } = await resolveTrainerRoots(user.id);
    return filterOptionsFromRoots(roots, accessible);
  },

  async filtersForAdmin(user: AuthUser) {
    if (!isProgramReviewer(user.role)) {
      throw ApiError.forbidden();
    }
    const roots = await resolveAdminRoots();
    return filterOptionsFromRoots(roots);
  },

  async forTrainee(user: AuthUser, programId?: string, batchId?: string) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    const { roots, enrollments } = await resolveTraineeRoots(user.id);
    let visible = enrollments;
    if (programId) {
      visible = visible.filter((row) => row.programId === programId);
    }
    if (batchId) {
      visible = visible.filter(
        (row) => row.batch?.id === batchId || row.batch?.linkedFromBatchId === batchId,
      );
    }
    if (programId && visible.length === 0) {
      throw ApiError.notFound("Enrollment not found");
    }
    if (batchId && visible.length === 0) {
      throw ApiError.notFound("Batch not found");
    }

    // One board only — full catalogs come from /leaderboard/filters.
    return {
      boards: await boardsForRootBatches(roots, programId, batchId, user.id, undefined, 1),
    };
  },

  async forTrainer(user: AuthUser, programId?: string, batchId?: string) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    if (programId) {
      await programService.requireTrainerOnProgram(user, programId);
    }
    if (!programId || !batchId) {
      return { boards: [] };
    }

    const { roots, accessible } = await resolveTrainerRoots(user.id);
    const boards = await boardsForRootBatches(roots, programId, batchId, undefined, accessible, 1);
    if (boards.length === 0) {
      throw ApiError.notFound("Batch not found");
    }
    return { boards };
  },

  async forAdmin(user: AuthUser, programId?: string, batchId?: string) {
    if (!isProgramReviewer(user.role)) {
      throw ApiError.forbidden();
    }
    if (!programId || !batchId) {
      return { boards: [] };
    }
    return { boards: [toPayload(await computeBoard(programId, batchId))] };
  },
};
