import {
  AssessmentAttemptStatus,
  AssignmentSubmissionStatus,
  QuizKind,
  type AttendanceStatus,
  type TrainingMode,
} from "../generated/prisma";
import { programRepository } from "../repositories/program.repository";
import { attendancePercentage } from "../utils/attendance-math";

export type ProgressStatus = "LOCKED" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETED" | "PASSED" | "FAILED";
export type LearnableItemType = "LESSON" | "VIDEO" | "RESOURCE" | "REEL";
export type TrackedKind =
  | LearnableItemType
  | "ASSIGNMENT"
  | "PRACTICE_QUIZ"
  | "WEEKLY_QUIZ"
  | "WEEKLY_EXAM"
  | "MILESTONE_EXAM"
  | "FINAL_EXAM";

export type AccessResult = {
  status: ProgressStatus;
  available: boolean;
  reason: string | null;
};

export type AttemptFact = {
  quizId: string;
  status: AssessmentAttemptStatus;
  score: number | null;
  passed: boolean | null;
  submittedAt: Date | null;
};

export type SubmissionFact = {
  assignmentId: string;
  status: AssignmentSubmissionStatus;
  score: number | null;
  submittedAt: Date | null;
  gradedAt: Date | null;
};

export type QuizAttemptState = {
  inProgress: boolean;
  passed: boolean;
  failed: boolean;
  bestScore: number | null;
  lastSubmittedAt: Date | null;
  attemptsUsed: number;
};

export type TraineeFacts = {
  completions: Map<string, Date>;
  quizzes: Map<string, QuizAttemptState>;
  submissions: Map<string, SubmissionFact>;
  attendancePercent: number | null;
};

export type ProgramTree = NonNullable<Awaited<ReturnType<typeof programRepository.findTreeById>>>;
export type WeekNode = ProgramTree["weeks"][number];
export type DayNode = WeekNode["days"][number];

export type StoredFileMeta = {
  fileName: string;
  mimeType: string;
  fileSize: number;
};

export type AttachmentMeta = StoredFileMeta & {
  id: string;
  title: string;
};

export type RawLearnable = {
  type: LearnableItemType;
  id: string;
  title: string;
  sortOrder: number;
  required: boolean;
  description?: string;
  url?: string;
  source?: DayNode["videos"][number]["source"];
  kind?: DayNode["resources"][number]["kind"];
  durationMin?: number;
  durationSec?: number;
  file?: StoredFileMeta;
  attachments?: AttachmentMeta[];
};

function storedFileMeta(row: {
  fileKey?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}): StoredFileMeta | undefined {
  if (!row.fileKey) {
    return undefined;
  }
  return {
    fileName: row.fileName ?? "file",
    mimeType: row.mimeType ?? "application/octet-stream",
    fileSize: row.fileSize ?? 0,
  };
}

export function attachmentMeta(
  rows: Array<{ id: string; title: string; fileName: string; mimeType: string; fileSize: number }>,
): AttachmentMeta[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
  }));
}

function closed(status: AssessmentAttemptStatus): boolean {
  return status === AssessmentAttemptStatus.SUBMITTED || status === AssessmentAttemptStatus.TIMED_OUT;
}

export function completionKey(type: LearnableItemType, id: string): string {
  return `${type}:${id}`;
}

export function itemsForDay(day: DayNode): RawLearnable[] {
  return [
    ...day.lessons.map((item) => ({
      type: "LESSON" as const,
      id: item.id,
      title: item.title,
      sortOrder: item.sortOrder,
      required: item.required,
      description: item.description,
      durationMin: item.durationMin,
      attachments: attachmentMeta(item.attachments ?? []),
    })),
    ...day.videos.map((item) => ({
      type: "VIDEO" as const,
      id: item.id,
      title: item.title,
      sortOrder: item.sortOrder,
      required: true,
      url: item.url,
      source: item.source,
      durationMin: item.durationMin,
      file: storedFileMeta(item),
    })),
    ...day.resources.map((item) => ({
      type: "RESOURCE" as const,
      id: item.id,
      title: item.title,
      sortOrder: item.sortOrder,
      required: item.required,
      description: item.description,
      url: item.url,
      kind: item.kind,
      file: storedFileMeta(item),
    })),
    ...day.reels.map((item) => ({
      type: "REEL" as const,
      id: item.id,
      title: item.title,
      sortOrder: item.sortOrder,
      required: true,
      url: item.url,
      durationSec: item.durationSec,
      file: storedFileMeta(item),
    })),
  ];
}

export function formatOpenDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function addWeeks(date: Date, weeks: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + weeks * 7);
  return next;
}

export function weekOpensAt(trainingMode: TrainingMode, programStartDate: Date | null, week: WeekNode): Date | null {
  if (trainingMode !== "SCHEDULED") {
    return week.startDate;
  }
  return week.startDate ?? (programStartDate ? addWeeks(programStartDate, week.sortOrder) : null);
}

export function buildFacts(input: {
  completions: Array<{ itemType: string; itemId: string; completedAt?: Date }>;
  attempts: AttemptFact[];
  submissions: SubmissionFact[];
  attendanceStatuses?: AttendanceStatus[];
}): TraineeFacts {
  const quizzes = new Map<string, QuizAttemptState>();
  const byQuiz = new Map<string, AttemptFact[]>();

  for (const attempt of input.attempts) {
    const list = byQuiz.get(attempt.quizId) ?? [];
    list.push(attempt);
    byQuiz.set(attempt.quizId, list);
  }

  for (const [quizId, attempts] of byQuiz) {
    const closedAttempts = attempts.filter((row) => closed(row.status));
    const scores = closedAttempts
      .map((row) => row.score)
      .filter((score): score is number => score !== null);
    const passed = closedAttempts.some((row) => row.passed === true);
    const submitted = closedAttempts
      .map((row) => row.submittedAt)
      .filter((value): value is Date => value !== null);
    quizzes.set(quizId, {
      inProgress: attempts.some((row) => row.status === AssessmentAttemptStatus.IN_PROGRESS),
      passed,
      failed: closedAttempts.length > 0 && !passed,
      bestScore: scores.length ? Math.max(...scores) : null,
      lastSubmittedAt: submitted.length ? submitted.reduce((latest, value) => (value > latest ? value : latest)) : null,
      attemptsUsed: closedAttempts.length,
    });
  }

  return {
    completions: new Map(
      input.completions.map((row) => [
        completionKey(row.itemType as LearnableItemType, row.itemId),
        row.completedAt ?? new Date(0),
      ]),
    ),
    quizzes,
    submissions: pickProgressSubmissions(input.submissions),
    attendancePercent: attendancePercentage(input.attendanceStatuses ?? []),
  };
}

function submissionProgressRank(status: AssignmentSubmissionStatus): number {
  if (status === AssignmentSubmissionStatus.GRADED || status === AssignmentSubmissionStatus.COMPLETED) {
    return 2;
  }
  if (status === AssignmentSubmissionStatus.SUBMITTED) {
    return 1;
  }
  return 0;
}

function pickProgressSubmissions(rows: SubmissionFact[]): Map<string, SubmissionFact> {
  const grouped = new Map<string, SubmissionFact[]>();
  for (const row of rows) {
    const list = grouped.get(row.assignmentId) ?? [];
    list.push(row);
    grouped.set(row.assignmentId, list);
  }
  const picked = new Map<string, SubmissionFact>();
  for (const [assignmentId, list] of grouped) {
    picked.set(
      assignmentId,
      list.reduce((best, row) => {
        const bestRank = submissionProgressRank(best.status);
        const rowRank = submissionProgressRank(row.status);
        if (rowRank > bestRank) {
          return row;
        }
        if (rowRank === bestRank && (row.score ?? 0) > (best.score ?? 0)) {
          return row;
        }
        return best;
      }),
    );
  }
  return picked;
}

export function quizState(facts: TraineeFacts, quizId: string): QuizAttemptState {
  return (
    facts.quizzes.get(quizId) ?? {
      inProgress: false,
      passed: false,
      failed: false,
      bestScore: null,
      lastSubmittedAt: null,
      attemptsUsed: 0,
    }
  );
}

export function contentCompleted(facts: TraineeFacts, type: LearnableItemType, id: string): boolean {
  return facts.completions.has(completionKey(type, id));
}

export function contentCompletedAt(facts: TraineeFacts, type: LearnableItemType, id: string): Date | null {
  return facts.completions.get(completionKey(type, id)) ?? null;
}

export function requiredLearnableComplete(items: RawLearnable[], facts: TraineeFacts): boolean {
  return items.filter((item) => item.required).every((item) => contentCompleted(facts, item.type, item.id));
}

function assignmentCountsForProgression(status: AssignmentSubmissionStatus): boolean {
  return (
    status === AssignmentSubmissionStatus.SUBMITTED ||
    status === AssignmentSubmissionStatus.GRADED ||
    status === AssignmentSubmissionStatus.COMPLETED
  );
}

export const LINKABLE_ITEM_TYPES = ["LESSON", "VIDEO", "RESOURCE", "REEL"] as const;
export type LinkableItemType = (typeof LINKABLE_ITEM_TYPES)[number];

export function isLinkableItemType(value: string | null | undefined): value is LinkableItemType {
  return Boolean(value && (LINKABLE_ITEM_TYPES as readonly string[]).includes(value));
}

export function dayHasLinkedAssignments(day: DayNode): boolean {
  return day.assignments.some(
    (assignment) => isLiveAssignment(assignment) && isLinkableItemType(assignment.linkedItemType) && assignment.linkedItemId,
  );
}

export function liveAssignmentsForItem(
  day: DayNode,
  itemType: LearnableItemType,
  itemId: string,
): DayNode["assignments"] {
  return day.assignments.filter(
    (assignment) =>
      isLiveAssignment(assignment) &&
      assignment.linkedItemType === itemType &&
      assignment.linkedItemId === itemId,
  );
}

export function itemSequenceComplete(
  day: DayNode,
  item: RawLearnable,
  facts: TraineeFacts,
): boolean {
  if (!contentCompleted(facts, item.type, item.id)) {
    return false;
  }
  return liveAssignmentsForItem(day, item.type, item.id).every((assignment) =>
    assignmentCompleteForGate(facts, assignment.id),
  );
}

export function priorSequenceComplete(
  day: DayNode,
  learnable: RawLearnable[],
  index: number,
  facts: TraineeFacts,
): boolean {
  if (!dayHasLinkedAssignments(day) || index <= 0) {
    return true;
  }
  return learnable.slice(0, index).every((item) => itemSequenceComplete(day, item, facts));
}

export function assignmentCompleteForGate(facts: TraineeFacts, assignmentId: string): boolean {
  const submission = facts.submissions.get(assignmentId);
  return Boolean(submission && assignmentCountsForProgression(submission.status));
}

export function assignmentFullyComplete(facts: TraineeFacts, assignmentId: string): boolean {
  const submission = facts.submissions.get(assignmentId);
  return Boolean(
    submission &&
      (submission.status === AssignmentSubmissionStatus.GRADED ||
        submission.status === AssignmentSubmissionStatus.COMPLETED),
  );
}

export function quizCanRetry(maxAttempts: number | null | undefined, state: QuizAttemptState): boolean {
  if (state.passed || state.inProgress || !state.failed) {
    return false;
  }
  if (maxAttempts == null) {
    return true;
  }
  return state.attemptsUsed < maxAttempts;
}

/** Unlocks the next step. Passed, or failed with no attempts left. Not a pass for credit. */
export function quizClearsProgressionGate(
  quiz: { id: string; maxAttempts?: number | null },
  facts: TraineeFacts,
): boolean {
  const state = quizState(facts, quiz.id);
  if (state.passed) {
    return true;
  }
  if (!state.failed || state.inProgress) {
    return false;
  }
  return !quizCanRetry(quiz.maxAttempts, state);
}

export function practiceQuizzesPassed(day: DayNode, facts: TraineeFacts): boolean {
  return day.quizzes
    .filter((quiz) => quiz.kind === QuizKind.PRACTICE_QUIZ)
    .every((quiz) => quizClearsProgressionGate(quiz, facts));
}

export function dayGatingComplete(day: DayNode, facts: TraineeFacts): boolean {
  return requiredLearnableComplete(itemsForDay(day), facts) && practiceQuizzesPassed(day, facts);
}

export function weekContentReady(week: WeekNode, facts: TraineeFacts): boolean {
  return week.days.every((day) => dayGatingComplete(day, facts));
}

export function isLiveAssignment(assignment: { status?: string }): boolean {
  return assignment.status !== "DRAFT";
}

export function weekGatingComplete(week: WeekNode, facts: TraineeFacts): boolean {
  if (!weekContentReady(week, facts)) {
    return false;
  }

  const assignmentsReady = week.days.every((day) =>
    day.assignments
      .filter(isLiveAssignment)
      .every((assignment) => assignmentCompleteForGate(facts, assignment.id)),
  );
  if (!assignmentsReady) {
    return false;
  }

  return week.quizzes
    .filter((quiz) => quiz.kind === QuizKind.WEEKLY_QUIZ || quiz.kind === QuizKind.WEEKLY_EXAM)
    .every((quiz) => quizClearsProgressionGate(quiz, facts));
}

export function itemWeight(kind: TrackedKind, required = true): number {
  switch (kind) {
    case "LESSON":
      return required ? 1 : 0;
    case "VIDEO":
      return 1;
    case "RESOURCE":
      return required ? 1 : 0;
    case "REEL":
      return 0.5;
    case "PRACTICE_QUIZ":
      return 1;
    case "WEEKLY_QUIZ":
      return 2;
    case "ASSIGNMENT":
      return 2;
    case "WEEKLY_EXAM":
      return 3;
    case "MILESTONE_EXAM":
      return 4;
    case "FINAL_EXAM":
      return 5;
    default:
      return 0;
  }
}

export function assignmentEarnedWeight(facts: TraineeFacts, assignmentId: string): number {
  const submission = facts.submissions.get(assignmentId);
  if (!submission) {
    return 0;
  }
  if (
    submission.status === AssignmentSubmissionStatus.GRADED ||
    submission.status === AssignmentSubmissionStatus.COMPLETED
  ) {
    return 2;
  }
  if (submission.status === AssignmentSubmissionStatus.SUBMITTED) {
    return 1;
  }
  return 0;
}

function withStatus(status: ProgressStatus, reason: string | null = null): AccessResult {
  return { status, available: status !== "LOCKED", reason: status === "LOCKED" ? reason : null };
}

function applyAttemptStatus(access: AccessResult, state: QuizAttemptState): AccessResult {
  if (access.status === "LOCKED") {
    return access;
  }
  if (state.passed) {
    return withStatus("PASSED");
  }
  if (state.inProgress) {
    return withStatus("IN_PROGRESS");
  }
  if (state.failed) {
    return withStatus("FAILED");
  }
  return access;
}

export const unlockService = {
  weekAccess(
    trainingMode: TrainingMode,
    programStartDate: Date | null,
    week: WeekNode,
    previousWeekComplete: boolean,
    previousWeekTitle: string | null,
    now: Date,
  ): AccessResult {
    if (trainingMode === "SCHEDULED") {
      const opensAt = weekOpensAt(trainingMode, programStartDate, week);
      if (opensAt && now < opensAt) {
        return withStatus("LOCKED", `This week opens on ${formatOpenDate(opensAt)}.`);
      }
      return withStatus("AVAILABLE");
    }

    if (!previousWeekComplete && previousWeekTitle) {
      return withStatus("LOCKED", `Complete ${previousWeekTitle} before accessing this content.`);
    }

    return withStatus("AVAILABLE");
  },

  dayAccess(
    trainingMode: TrainingMode,
    weekAccess: AccessResult,
    previousDayComplete: boolean,
    previousDayTitle: string | null,
  ): AccessResult {
    if (weekAccess.status === "LOCKED") {
      return weekAccess;
    }

    if (trainingMode === "PROGRESSION" && !previousDayComplete && previousDayTitle) {
      return withStatus("LOCKED", `Complete ${previousDayTitle} before accessing this content.`);
    }

    return withStatus("AVAILABLE");
  },

  contentAccess(dayAccess: AccessResult, completed: boolean, priorSequenceCompleteFlag = true): AccessResult {
    if (completed) {
      return withStatus("COMPLETED");
    }
    if (dayAccess.status === "LOCKED") {
      return dayAccess;
    }
    if (!priorSequenceCompleteFlag) {
      return withStatus("LOCKED", "Finish the previous file and its assignment first.");
    }
    return withStatus("AVAILABLE");
  },

  practiceQuizAccess(
    trainingMode: TrainingMode,
    dayAccess: AccessResult,
    learnableRequiredComplete: boolean,
    facts: TraineeFacts,
    quizId: string,
  ): AccessResult {
    if (dayAccess.status === "LOCKED") {
      return dayAccess;
    }
    if (trainingMode === "PROGRESSION" && !learnableRequiredComplete) {
      return withStatus("LOCKED", "Complete this day's required lessons before the quiz.");
    }
    return applyAttemptStatus(withStatus("AVAILABLE"), quizState(facts, quizId));
  },

  assignmentAccess(
    trainingMode: TrainingMode,
    dayAccess: AccessResult,
    learnableRequiredComplete: boolean,
    practicePassed: boolean,
    facts: TraineeFacts,
    assignmentId: string,
    linked?: { fileComplete: boolean; priorComplete: boolean } | null,
  ): AccessResult {
    if (dayAccess.status === "LOCKED") {
      return dayAccess;
    }
    if (linked) {
      if (!linked.priorComplete) {
        return withStatus("LOCKED", "Finish the previous file and its assignment first.");
      }
      if (!linked.fileComplete) {
        return withStatus("LOCKED", "Finish this file before the assignment.");
      }
    } else {
      if (trainingMode === "PROGRESSION" && !learnableRequiredComplete) {
        return withStatus("LOCKED", "Complete this day's required lessons before the assignment.");
      }
      if (trainingMode === "PROGRESSION" && !practicePassed) {
        return withStatus("LOCKED", "Pass this day's quiz before the assignment.");
      }
    }

    const submission = facts.submissions.get(assignmentId);
    if (!submission || submission.status === AssignmentSubmissionStatus.CHANGES_REQUESTED) {
      return withStatus("AVAILABLE");
    }
    if (submission.status === AssignmentSubmissionStatus.IN_PROGRESS) {
      return withStatus("IN_PROGRESS");
    }
    if (
      submission.status === AssignmentSubmissionStatus.SUBMITTED ||
      submission.status === AssignmentSubmissionStatus.GRADED ||
      submission.status === AssignmentSubmissionStatus.COMPLETED
    ) {
      return withStatus("COMPLETED");
    }
    return withStatus("AVAILABLE");
  },

  weeklyAssessmentAccess(
    trainingMode: TrainingMode,
    weekAccess: AccessResult,
    weekContentReadyFlag: boolean,
    facts: TraineeFacts,
    quizId: string,
  ): AccessResult {
    if (weekAccess.status === "LOCKED") {
      return weekAccess;
    }
    if (trainingMode === "PROGRESSION" && !weekContentReadyFlag) {
      return withStatus("LOCKED", "Complete this week's lessons and practice quizzes first.");
    }
    return applyAttemptStatus(withStatus("AVAILABLE"), quizState(facts, quizId));
  },

  milestoneExamAccess(input: {
    weeksComplete: boolean;
    incompleteWeekTitle: string | null;
    blockingUnmet: { label: string } | null;
    facts: TraineeFacts;
    quizId: string;
  }): AccessResult {
    if (!input.weeksComplete && input.incompleteWeekTitle) {
      return withStatus("LOCKED", `Complete ${input.incompleteWeekTitle} before this milestone exam.`);
    }
    if (!input.weeksComplete) {
      return withStatus("LOCKED", "Complete the required weeks before this milestone exam.");
    }
    if (input.blockingUnmet) {
      return withStatus("LOCKED", `Missing requirement: ${input.blockingUnmet.label}.`);
    }
    return applyAttemptStatus(withStatus("AVAILABLE"), quizState(input.facts, input.quizId));
  },

  finalExamAccess(eligible: boolean, reasons: string[], facts: TraineeFacts, quizId: string): AccessResult {
    if (!eligible) {
      return withStatus("LOCKED", reasons[0] ?? "Complete required conditions before the final exam.");
    }
    return applyAttemptStatus(withStatus("AVAILABLE"), quizState(facts, quizId));
  },
};
