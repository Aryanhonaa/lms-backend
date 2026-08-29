import { QuizKind } from "../generated/prisma";
import {
  quizClearsProgressionGate,
  quizState,
  type ProgramTree,
  type TraineeFacts,
} from "./unlock.service";

export type CourseOutcome = "PENDING" | "PASSED" | "FAILED";
export type CourseRunStatus = "IN_PROGRESS" | "FINISHED";

const REQUIRED_PASS_KINDS = new Set<QuizKind>([
  QuizKind.PRACTICE_QUIZ,
  QuizKind.WEEKLY_QUIZ,
  QuizKind.WEEKLY_EXAM,
  QuizKind.MILESTONE_EXAM,
  QuizKind.FINAL_EXAM,
]);

export type FailedAssessmentSummary = {
  id: string;
  title: string;
  kind: string;
  score: number | null;
  passingScore: number;
  attemptsUsed: number;
  maxAttempts: number | null;
};

export type CourseOutcomeResult = {
  outcome: CourseOutcome;
  courseStatus: CourseRunStatus;
  failedAssessments: FailedAssessmentSummary[];
  lastActivityAt: string | null;
  finishedAt: string | null;
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

function latestActivityAt(facts: TraineeFacts): Date | null {
  const dates: Date[] = [...facts.completions.values()];
  for (const state of facts.quizzes.values()) {
    if (state.lastSubmittedAt) {
      dates.push(state.lastSubmittedAt);
    }
  }
  for (const submission of facts.submissions.values()) {
    if (submission.gradedAt) {
      dates.push(submission.gradedAt);
    } else if (submission.submittedAt) {
      dates.push(submission.submittedAt);
    }
  }
  if (dates.length === 0) {
    return null;
  }
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

export function evaluateCourseOutcome(
  program: ProgramTree,
  facts: TraineeFacts,
  weekCompleteByOrder: Map<number, boolean>,
): CourseOutcomeResult {
  const quizzes = collectQuizzes(program);
  const requiredQuizzes = quizzes.filter((quiz) => REQUIRED_PASS_KINDS.has(quiz.kind));
  const weeksFinished = program.weeks.every((week) => weekCompleteByOrder.get(week.sortOrder) === true);
  const finalQuiz = quizzes.find((quiz) => quiz.kind === QuizKind.FINAL_EXAM) ?? null;
  const finalCleared = !finalQuiz || quizClearsProgressionGate(finalQuiz, facts);
  const finished = weeksFinished && finalCleared;
  const lastActivity = latestActivityAt(facts);
  const lastActivityAt = lastActivity?.toISOString() ?? null;

  const failedAssessments: FailedAssessmentSummary[] = requiredQuizzes
    .filter((quiz) => {
      const state = quizState(facts, quiz.id);
      return state.failed && !state.passed;
    })
    .map((quiz) => {
      const state = quizState(facts, quiz.id);
      return {
        id: quiz.id,
        title: quiz.title,
        kind: quiz.kind,
        score: state.bestScore,
        passingScore: quiz.passingScore,
        attemptsUsed: state.attemptsUsed,
        maxAttempts: quiz.maxAttempts ?? null,
      };
    });

  const allRequiredPassed = requiredQuizzes.every((quiz) => quizState(facts, quiz.id).passed);

  if (!finished) {
    return {
      outcome: "PENDING",
      courseStatus: "IN_PROGRESS",
      failedAssessments,
      lastActivityAt,
      finishedAt: null,
    };
  }
  if (allRequiredPassed) {
    return {
      outcome: "PASSED",
      courseStatus: "FINISHED",
      failedAssessments: [],
      lastActivityAt,
      finishedAt: lastActivityAt,
    };
  }
  return {
    outcome: "FAILED",
    courseStatus: "FINISHED",
    failedAssessments,
    lastActivityAt,
    finishedAt: lastActivityAt,
  };
}
