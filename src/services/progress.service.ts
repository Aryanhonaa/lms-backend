import {
  EnrollmentStatus,
  MilestoneRequirementKind,
  ProgramStatus,
  QuizKind,
  type AttendanceStatus,
  type Prisma,
} from "../generated/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programRepository } from "../repositories/program.repository";
import { enrollmentService } from "./enrollment.service";
import { interventionService } from "./intervention.service";
import { achievementService } from "./achievement.service";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";
import {
  assignmentEarnedWeight,
  assignmentFullyComplete,
  attachmentMeta,
  buildFacts,
  isLiveAssignment,
  isLinkableItemType,
  contentCompleted,
  contentCompletedAt,
  dayGatingComplete,
  itemWeight,
  itemsForDay,
  practiceQuizzesPassed,
  priorSequenceComplete,
  quizState,
  requiredLearnableComplete,
  unlockService,
  weekContentReady,
  weekGatingComplete,
  type AccessResult,
  type DayNode,
  type LearnableItemType,
  type ProgramTree,
  type ProgressStatus,
  type RawLearnable,
  type TrackedKind,
  type TraineeFacts,
  type WeekNode,
} from "./unlock.service";

const VISIBLE_STATUSES: ProgramStatus[] = [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED];

export type PublicLearnItem = {
  type: LearnableItemType;
  id: string;
  title: string;
  status: ProgressStatus;
  reason: string | null;
  required: boolean;
  durationMin?: number;
  durationSec?: number;
  kind?: RawLearnable["kind"];
  source?: RawLearnable["source"];
  description?: string;
  url?: string;
  file?: RawLearnable["file"];
  attachments?: RawLearnable["attachments"];
};

export type LearnPathType = LearnableItemType | "QUIZ" | "ASSIGNMENT";

export type LearnPathActivity = {
  type: LearnPathType;
  kind?: TrackedKind;
  id: string;
  title: string;
  weekTitle: string;
  dayTitle: string | null;
};

export type PublicLearnQuiz = {
  id: string;
  title: string;
  kind: string;
  status: ProgressStatus;
  reason: string | null;
};

export type ProgressActivity = {
  kind: TrackedKind;
  id: string;
  title: string;
  weekTitle: string;
  dayTitle: string | null;
};

export type RequirementStatus = {
  id: string;
  kind: MilestoneRequirementKind;
  label: string;
  targetCount: number;
  complete: boolean;
  blocking: boolean;
  display: "Complete" | "Missing";
};

export type MilestoneProgress = {
  id: string;
  title: string;
  afterWeekIndex: number;
  sortOrder: number;
  satisfied: boolean;
  status: ProgressStatus;
  reason: string | null;
  requirements: RequirementStatus[];
  exam: {
    id: string;
    title: string;
    status: ProgressStatus;
    reason: string | null;
    available: boolean;
  } | null;
};

export type EligibilityRequirement = {
  label: string;
  met: boolean;
};

export type FinalExamEligibility = {
  configured: boolean;
  examId: string | null;
  title: string | null;
  eligible: boolean;
  status: ProgressStatus;
  reason: string | null;
  reasons: string[];
  requirements: EligibilityRequirement[];
};

export type TrackedProgressItem = {
  kind: TrackedKind;
  id: string;
  title: string;
  status: ProgressStatus;
  reason: string | null;
  available: boolean;
  weight: number;
  earnedWeight: number;
  score: number | null;
  completedAt: string | null;
  weekTitle: string;
  dayTitle: string | null;
};

type ProgressSnapshot = {
  percent: number;
  completedWeight: number;
  totalWeight: number;
  completedItems: number;
  remainingItems: number;
  currentWeekIndex: number;
  currentDayIndex: number;
  currentWeekTitle: string | null;
  currentDayTitle: string | null;
  nextLearnActivity: {
    type: LearnableItemType;
    id: string;
    title: string;
    weekTitle: string;
    dayTitle: string;
  } | null;
  nextActivity: ProgressActivity | null;
  currentActivity: ProgressActivity | null;
  currentMilestone: { id: string; title: string } | null;
  programUpdatedAt: string;
  computedAt: string;
};

export type ProgressComputation = {
  enrollment: {
    id: string;
    status: EnrollmentStatus;
    overallProgress: number;
    currentWeekIndex: number;
    currentDayIndex: number;
  };
  program: {
    id: string;
    title: string;
    description: string;
    category: string;
    difficulty: string;
    durationWeeks: number;
    trainingMode: string;
    status: string;
    updatedAt: Date;
  };
  currentWeek: { id: string; title: string; sortOrder: number; status: ProgressStatus } | null;
  currentDay: { id: string; title: string; sortOrder: number; status: ProgressStatus } | null;
  nextActivity: ProgressActivity | null;
  currentActivity: ProgressActivity | null;
  nextLearnActivity: ProgressSnapshot["nextLearnActivity"];
  progress: {
    completedRequired: number;
    totalRequired: number;
    completedWeight: number;
    totalWeight: number;
    completedItems: number;
    remainingItems: number;
    percent: number;
  };
  weeks: Array<{
    id: string;
    sortOrder: number;
    title: string;
    status: ProgressStatus;
    reason: string | null;
    gatingComplete: boolean;
    percent: number;
    completedWeight: number;
    totalWeight: number;
    days: Array<{
      id: string;
      sortOrder: number;
      title: string;
      status: ProgressStatus;
      reason: string | null;
      items: PublicLearnItem[];
      quizzes: PublicLearnQuiz[];
      assignments: Array<{
        id: string;
        title: string;
        status: ProgressStatus;
        reason: string | null;
        dueDate: Date | null;
        maxScore: number;
        description?: string;
        linkedItemType?: string | null;
        linkedItemId?: string | null;
        attachments?: ReturnType<typeof attachmentMeta>;
      }>;
    }>;
    quizzes: PublicLearnQuiz[];
  }>;
  items: TrackedProgressItem[];
  milestones: MilestoneProgress[];
  currentMilestone: { id: string; title: string } | null;
  finalExam: FinalExamEligibility;
  quizAccess: Map<string, AccessResult>;
  assignmentAccess: Map<string, AccessResult>;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundPercent(earned: number, total: number): number {
  if (total <= 0) {
    return 100;
  }
  return Math.round((earned / total) * 10000) / 100;
}

function toPublicItem(item: RawLearnable, access: AccessResult): PublicLearnItem {
  const publicItem: PublicLearnItem = {
    type: item.type,
    id: item.id,
    title: item.title,
    status: access.status,
    reason: access.status === "LOCKED" ? access.reason : null,
    required: item.required,
    durationMin: item.durationMin,
    durationSec: item.durationSec,
    kind: item.kind,
  };

  if (access.status === "LOCKED") {
    return publicItem;
  }

  return {
    ...publicItem,
    source: item.source,
    description: item.description,
    // Files stored by the LMS are served through authorized access endpoints, never as a raw storage URL.
    url: item.file ? undefined : item.url,
    file: item.file,
    attachments: item.attachments && item.attachments.length > 0 ? item.attachments : undefined,
  };
}

function activityFrom(
  kind: TrackedKind,
  id: string,
  title: string,
  weekTitle: string,
  dayTitle: string | null,
): ProgressActivity {
  return { kind, id, title, weekTitle, dayTitle };
}

function toLearnPathActivity(activity: ProgressActivity | null): LearnPathActivity | null {
  if (!activity) {
    return null;
  }
  if (activity.kind === "ASSIGNMENT") {
    return {
      type: "ASSIGNMENT",
      kind: activity.kind,
      id: activity.id,
      title: activity.title,
      weekTitle: activity.weekTitle,
      dayTitle: activity.dayTitle,
    };
  }
  if (
    activity.kind === "PRACTICE_QUIZ" ||
    activity.kind === "WEEKLY_QUIZ" ||
    activity.kind === "WEEKLY_EXAM" ||
    activity.kind === "MILESTONE_EXAM" ||
    activity.kind === "FINAL_EXAM"
  ) {
    return {
      type: "QUIZ",
      kind: activity.kind,
      id: activity.id,
      title: activity.title,
      weekTitle: activity.weekTitle,
      dayTitle: activity.dayTitle,
    };
  }
  return {
    type: activity.kind,
    kind: activity.kind,
    id: activity.id,
    title: activity.title,
    weekTitle: activity.weekTitle,
    dayTitle: activity.dayTitle,
  };
}

function toPublicQuiz(quiz: { id: string; title: string; kind: string }, access: AccessResult): PublicLearnQuiz {
  return {
    id: quiz.id,
    title: quiz.title,
    kind: quiz.kind,
    status: access.status,
    reason: access.status === "LOCKED" ? access.reason : null,
  };
}

function considerActivity(
  access: AccessResult,
  activity: ProgressActivity,
  current: { next: ProgressActivity | null; current: ProgressActivity | null },
) {
  if (access.status === "LOCKED" || access.status === "COMPLETED" || access.status === "PASSED") {
    return;
  }
  if (!current.current) {
    current.current = activity;
  }
  if (!current.next && (access.status === "AVAILABLE" || access.status === "IN_PROGRESS" || access.status === "FAILED")) {
    current.next = activity;
  }
}

function trackItem(
  items: TrackedProgressItem[],
  totals: { weight: number; earned: number; completed: number; countable: number },
  input: {
    kind: TrackedKind;
    id: string;
    title: string;
    access: AccessResult;
    weight: number;
    earnedWeight: number;
    score: number | null;
    completedAt: string | null;
    weekTitle: string;
    dayTitle: string | null;
  },
) {
  totals.weight += input.weight;
  totals.earned += input.earnedWeight;
  if (input.weight > 0) {
    totals.countable += 1;
    if (input.earnedWeight >= input.weight) {
      totals.completed += 1;
    }
  }
  items.push({
    kind: input.kind,
    id: input.id,
    title: input.title,
    status: input.access.status,
    reason: input.access.reason,
    available: input.access.available,
    weight: input.weight,
    earnedWeight: input.earnedWeight,
    score: input.score,
    completedAt: input.completedAt,
    weekTitle: input.weekTitle,
    dayTitle: input.dayTitle,
  });
}

function evaluateRequirement(
  requirement: ProgramTree["milestones"][number]["requirements"][number],
  program: ProgramTree,
  facts: TraineeFacts,
  weekCompleteByOrder: Map<number, boolean>,
  milestone: ProgramTree["milestones"][number],
): RequirementStatus {
  const weeksThrough = program.weeks.filter((week) => week.sortOrder <= milestone.afterWeekIndex);
  const completedWeeks = weeksThrough.filter((week) => weekCompleteByOrder.get(week.sortOrder)).length;

  const quizzesInScope = [
    ...weeksThrough.flatMap((week) => week.days.flatMap((day) => day.quizzes)),
    ...weeksThrough.flatMap((week) => week.quizzes),
  ].filter((quiz) => quiz.kind !== QuizKind.PRACTICE_QUIZ);

  const assignmentsInScope = weeksThrough.flatMap((week) => week.days.flatMap((day) => day.assignments));
  const passedAssessments = quizzesInScope.filter((quiz) => quizState(facts, quiz.id).passed).length;
  const completedAssignments = assignmentsInScope.filter((assignment) => assignmentFullyComplete(facts, assignment.id)).length;

  let complete = false;
  let blocking = true;

  switch (requirement.kind) {
    case MilestoneRequirementKind.WEEKS_COMPLETED:
      complete = completedWeeks >= requirement.targetCount;
      break;
    case MilestoneRequirementKind.ASSESSMENTS_PASSED:
      complete = passedAssessments >= requirement.targetCount;
      break;
    case MilestoneRequirementKind.ASSIGNMENTS_COMPLETE:
      complete =
        requirement.targetCount > 0
          ? completedAssignments >= requirement.targetCount
          : assignmentsInScope.every((assignment) => assignmentFullyComplete(facts, assignment.id));
      break;
    case MilestoneRequirementKind.ATTENDANCE:
      complete = facts.attendancePercent !== null && facts.attendancePercent >= requirement.targetCount;
      blocking = true;
      break;
    case MilestoneRequirementKind.CUSTOM:
      complete = false;
      blocking = false;
      break;
    default:
      complete = false;
      blocking = false;
  }

  return {
    id: requirement.id,
    kind: requirement.kind,
    label: requirement.label,
    targetCount: requirement.targetCount,
    complete,
    blocking,
    display: complete ? "Complete" : "Missing",
  };
}

function computeEngine(program: ProgramTree, enrollmentId: string, facts: TraineeFacts, now: Date): ProgressComputation {
  const quizAccess = new Map<string, AccessResult>();
  const assignmentAccess = new Map<string, AccessResult>();
  const items: TrackedProgressItem[] = [];
  const totals = { weight: 0, earned: 0, completed: 0, countable: 0 };
  const activities = { next: null as ProgressActivity | null, current: null as ProgressActivity | null };
  let nextLearnActivity: ProgressSnapshot["nextLearnActivity"] = null;
  let totalRequired = 0;
  let completedRequired = 0;
  let previousWeekComplete = true;
  let previousWeekTitle: string | null = null;
  let currentWeekIndex = program.weeks[0]?.sortOrder ?? 0;
  let currentDayIndex = program.weeks[0]?.days[0]?.sortOrder ?? 0;
  let foundCurrent = false;
  const weekCompleteByOrder = new Map<number, boolean>();

  const weeks = program.weeks.map((week: WeekNode) => {
    const weekAccess = unlockService.weekAccess(
      program.trainingMode,
      program.startDate,
      week,
      previousWeekComplete,
      previousWeekTitle,
      now,
    );
    let previousDayComplete = weekAccess.status !== "LOCKED";
    let previousDayTitle: string | null = null;
    const weekTotals = { weight: 0, earned: 0 };

    const days = week.days.map((day: DayNode) => {
      const dayAccess = unlockService.dayAccess(
        program.trainingMode,
        weekAccess,
        previousDayComplete,
        previousDayTitle,
      );
      const learnable = itemsForDay(day);
      const learnableReady = requiredLearnableComplete(learnable, facts);
      const practicePassed = practiceQuizzesPassed(day, facts);

      const publicItems = learnable.map((item, index) => {
        const completed = contentCompleted(facts, item.type, item.id);
        const completedAt = contentCompletedAt(facts, item.type, item.id);
        const priorComplete = priorSequenceComplete(day, learnable, index, facts);
        const access = unlockService.contentAccess(dayAccess, completed, priorComplete);
        const weight = itemWeight(item.type, item.required);
        if (item.required) {
          totalRequired += 1;
          if (completed) {
            completedRequired += 1;
          }
        }
        weekTotals.weight += weight;
        weekTotals.earned += completed ? weight : 0;
        trackItem(items, totals, {
          kind: item.type,
          id: item.id,
          title: item.title,
          access,
          weight,
          earnedWeight: completed ? weight : 0,
          score: null,
          completedAt: completedAt?.toISOString() ?? null,
          weekTitle: week.title,
          dayTitle: day.title,
        });
        considerActivity(access, activityFrom(item.type, item.id, item.title, week.title, day.title), activities);
        if (!nextLearnActivity && access.status === "AVAILABLE") {
          nextLearnActivity = {
            type: item.type,
            id: item.id,
            title: item.title,
            weekTitle: week.title,
            dayTitle: day.title,
          };
        }
        if (!foundCurrent && access.status !== "COMPLETED" && access.status !== "LOCKED" && access.status !== "PASSED") {
          foundCurrent = true;
          currentWeekIndex = week.sortOrder;
          currentDayIndex = day.sortOrder;
        }
        return toPublicItem(item, access);
      });

      for (const quiz of day.quizzes) {
        const access = unlockService.practiceQuizAccess(
          program.trainingMode,
          dayAccess,
          learnableReady,
          facts,
          quiz.id,
        );
        quizAccess.set(quiz.id, access);
        const state = quizState(facts, quiz.id);
        const weight = itemWeight(quiz.kind as TrackedKind);
        weekTotals.weight += weight;
        weekTotals.earned += state.passed ? weight : 0;
        trackItem(items, totals, {
          kind: quiz.kind as TrackedKind,
          id: quiz.id,
          title: quiz.title,
          access,
          weight,
          earnedWeight: state.passed ? weight : 0,
          score: state.bestScore,
          completedAt: state.lastSubmittedAt?.toISOString() ?? null,
          weekTitle: week.title,
          dayTitle: day.title,
        });
        considerActivity(access, activityFrom(quiz.kind as TrackedKind, quiz.id, quiz.title, week.title, day.title), activities);
      }

      for (const assignment of day.assignments) {
        if (!isLiveAssignment(assignment)) {
          continue;
        }
        const linkedType = isLinkableItemType(assignment.linkedItemType) ? assignment.linkedItemType : null;
        const linkedId = assignment.linkedItemId;
        const linkedIndex =
          linkedType && linkedId ? learnable.findIndex((item) => item.type === linkedType && item.id === linkedId) : -1;
        const linkedItem = linkedIndex >= 0 ? learnable[linkedIndex] : undefined;
        const linked = linkedItem
          ? {
              fileComplete: contentCompleted(facts, linkedItem.type, linkedItem.id),
              priorComplete: priorSequenceComplete(day, learnable, linkedIndex, facts),
            }
          : null;
        const access = unlockService.assignmentAccess(
          program.trainingMode,
          dayAccess,
          learnableReady,
          practicePassed,
          facts,
          assignment.id,
          linked,
        );
        assignmentAccess.set(assignment.id, access);
        const weight = itemWeight("ASSIGNMENT");
        const earned = assignmentEarnedWeight(facts, assignment.id);
        const submission = facts.submissions.get(assignment.id);
        weekTotals.weight += weight;
        weekTotals.earned += earned;
        trackItem(items, totals, {
          kind: "ASSIGNMENT",
          id: assignment.id,
          title: assignment.title,
          access,
          weight,
          earnedWeight: earned,
          score: submission?.score ?? null,
          completedAt: submission?.gradedAt?.toISOString() ?? submission?.submittedAt?.toISOString() ?? null,
          weekTitle: week.title,
          dayTitle: day.title,
        });
        considerActivity(access, activityFrom("ASSIGNMENT", assignment.id, assignment.title, week.title, day.title), activities);
      }

      previousDayComplete = dayGatingComplete(day, facts);
      previousDayTitle = day.title;

      return {
        id: day.id,
        sortOrder: day.sortOrder,
        title: day.title,
        status: dayAccess.status,
        reason: dayAccess.reason,
        items: publicItems,
        quizzes: day.quizzes.map((quiz) =>
          toPublicQuiz(
            quiz,
            quizAccess.get(quiz.id) ?? {
              status: "LOCKED",
              available: false,
              reason: "This quiz is locked.",
            },
          ),
        ),
        assignments: day.assignments.filter(isLiveAssignment).map((assignment) => {
          const access = assignmentAccess.get(assignment.id) ?? {
            status: "LOCKED" as const,
            available: false,
            reason: "This assignment is locked.",
          };
          return {
            id: assignment.id,
            title: assignment.title,
            status: access.status,
            reason: access.reason,
            dueDate: access.status === "LOCKED" ? null : assignment.dueDate,
            maxScore: assignment.maxScore,
            description: access.status === "LOCKED" ? undefined : assignment.description,
            linkedItemType: assignment.linkedItemType ?? null,
            linkedItemId: assignment.linkedItemId ?? null,
            attachments:
              access.status === "LOCKED" || !assignment.attachments?.length
                ? undefined
                : attachmentMeta(assignment.attachments),
          };
        }),
      };
    });

    const contentReady = weekContentReady(week, facts);
    for (const quiz of week.quizzes) {
      const access = unlockService.weeklyAssessmentAccess(
        program.trainingMode,
        weekAccess,
        contentReady,
        facts,
        quiz.id,
      );
      quizAccess.set(quiz.id, access);
      const state = quizState(facts, quiz.id);
      const weight = itemWeight(quiz.kind as TrackedKind);
      weekTotals.weight += weight;
      weekTotals.earned += state.passed ? weight : 0;
      trackItem(items, totals, {
        kind: quiz.kind as TrackedKind,
        id: quiz.id,
        title: quiz.title,
        access,
        weight,
        earnedWeight: state.passed ? weight : 0,
        score: state.bestScore,
        completedAt: state.lastSubmittedAt?.toISOString() ?? null,
        weekTitle: week.title,
        dayTitle: null,
      });
      considerActivity(access, activityFrom(quiz.kind as TrackedKind, quiz.id, quiz.title, week.title, null), activities);
    }

    const gatingComplete = weekGatingComplete(week, facts);
    weekCompleteByOrder.set(week.sortOrder, gatingComplete);
    previousWeekComplete = weekAccess.status !== "LOCKED" && gatingComplete;
    previousWeekTitle = week.title;

    return {
      id: week.id,
      sortOrder: week.sortOrder,
      title: week.title,
      status: weekAccess.status,
      reason: weekAccess.reason,
      gatingComplete,
      percent: roundPercent(weekTotals.earned, weekTotals.weight),
      completedWeight: weekTotals.earned,
      totalWeight: weekTotals.weight,
      days,
      quizzes: week.quizzes.map((quiz) =>
        toPublicQuiz(
          quiz,
          quizAccess.get(quiz.id) ?? {
            status: "LOCKED",
            available: false,
            reason: "This quiz is locked.",
          },
        ),
      ),
    };
  });

  const milestones: MilestoneProgress[] = program.milestones.map((milestone) => {
    const priorWeeks = program.weeks.filter((week) => week.sortOrder <= milestone.afterWeekIndex);
    const incompleteWeek = priorWeeks.find((week) => !weekCompleteByOrder.get(week.sortOrder));
    const weeksComplete = !incompleteWeek;
    const requirements = milestone.requirements.map((requirement) =>
      evaluateRequirement(requirement, program, facts, weekCompleteByOrder, milestone),
    );
    const blockingUnmet = requirements.find((requirement) => requirement.blocking && !requirement.complete) ?? null;
    const satisfied = weeksComplete && !blockingUnmet;
    let examAccess: AccessResult | null = null;
    if (milestone.exam) {
      examAccess = unlockService.milestoneExamAccess({
        weeksComplete,
        incompleteWeekTitle: incompleteWeek?.title ?? null,
        blockingUnmet,
        facts,
        quizId: milestone.exam.id,
      });
      quizAccess.set(milestone.exam.id, examAccess);
      const state = quizState(facts, milestone.exam.id);
      const weight = itemWeight("MILESTONE_EXAM");
      trackItem(items, totals, {
        kind: "MILESTONE_EXAM",
        id: milestone.exam.id,
        title: milestone.exam.title,
        access: examAccess,
        weight,
        earnedWeight: state.passed ? weight : 0,
        score: state.bestScore,
        completedAt: state.lastSubmittedAt?.toISOString() ?? null,
        weekTitle: milestone.title,
        dayTitle: null,
      });
      considerActivity(
        examAccess,
        activityFrom("MILESTONE_EXAM", milestone.exam.id, milestone.exam.title, milestone.title, null),
        activities,
      );
    }

    return {
      id: milestone.id,
      title: milestone.title,
      afterWeekIndex: milestone.afterWeekIndex,
      sortOrder: milestone.sortOrder,
      satisfied,
      status: examAccess?.status ?? (satisfied ? "COMPLETED" : "LOCKED"),
      reason: examAccess?.reason ?? (satisfied ? null : blockingUnmet?.label ?? incompleteWeek?.title ?? "Requirements not met"),
      requirements,
      exam: milestone.exam && examAccess
        ? {
            id: milestone.exam.id,
            title: milestone.exam.title,
            status: examAccess.status,
            reason: examAccess.reason,
            available: examAccess.available,
          }
        : null,
    };
  });

  const eligibilityRequirements: EligibilityRequirement[] = [];
  for (const week of weeks) {
    eligibilityRequirements.push({
      label: `${week.title} complete`,
      met: week.gatingComplete,
    });
  }
  for (const week of program.weeks) {
    for (const quiz of week.quizzes) {
      eligibilityRequirements.push({
        label: `${quiz.title} passed`,
        met: quizState(facts, quiz.id).passed,
      });
    }
    for (const day of week.days) {
      for (const assignment of day.assignments) {
        eligibilityRequirements.push({
          label: `${assignment.title} graded`,
          met: assignmentFullyComplete(facts, assignment.id),
        });
      }
    }
  }
  for (const milestone of milestones) {
    eligibilityRequirements.push({
      label: `${milestone.title} requirements`,
      met: milestone.satisfied,
    });
    if (milestone.exam) {
      eligibilityRequirements.push({
        label: `${milestone.exam.title} passed`,
        met: quizState(facts, milestone.exam.id).passed,
      });
    }
    for (const requirement of milestone.requirements) {
      if (requirement.kind === MilestoneRequirementKind.ATTENDANCE) {
        eligibilityRequirements.push({
          label: requirement.label,
          met: requirement.complete,
        });
      }
    }
  }

  const eligible = eligibilityRequirements.every((requirement) => requirement.met);
  const reasons = eligibilityRequirements.filter((requirement) => !requirement.met).map((requirement) => requirement.label);
  const finalQuiz = program.quizzes.find((quiz) => quiz.kind === QuizKind.FINAL_EXAM) ?? null;
  let finalAccess: AccessResult = {
    status: "LOCKED",
    available: false,
    reason: "This program has no final exam.",
  };
  if (finalQuiz) {
    finalAccess = unlockService.finalExamAccess(eligible, reasons, facts, finalQuiz.id);
    quizAccess.set(finalQuiz.id, finalAccess);
    const state = quizState(facts, finalQuiz.id);
    const weight = itemWeight("FINAL_EXAM");
    trackItem(items, totals, {
      kind: "FINAL_EXAM",
      id: finalQuiz.id,
      title: finalQuiz.title,
      access: finalAccess,
      weight,
      earnedWeight: state.passed ? weight : 0,
      score: state.bestScore,
      completedAt: state.lastSubmittedAt?.toISOString() ?? null,
      weekTitle: "Final exam",
      dayTitle: null,
    });
    considerActivity(finalAccess, activityFrom("FINAL_EXAM", finalQuiz.id, finalQuiz.title, "Final exam", null), activities);
  }

  if (!foundCurrent && program.weeks.length > 0) {
    const lastWeek = program.weeks[program.weeks.length - 1];
    currentWeekIndex = lastWeek.sortOrder;
    currentDayIndex = lastWeek.days[lastWeek.days.length - 1]?.sortOrder ?? 0;
  }

  const percent = roundPercent(totals.earned, totals.weight);
  const currentWeek = weeks.find((week) => week.sortOrder === currentWeekIndex) ?? weeks[0] ?? null;
  const currentDay =
    currentWeek?.days.find((day) => day.sortOrder === currentDayIndex) ?? currentWeek?.days[0] ?? null;
  const currentMilestone =
    milestones.find((milestone) => !milestone.satisfied || (milestone.exam && !quizState(facts, milestone.exam.id).passed)) ??
    milestones[milestones.length - 1] ??
    null;

  return {
    enrollment: {
      id: enrollmentId,
      status: percent >= 100 ? EnrollmentStatus.COMPLETED : EnrollmentStatus.ACTIVE,
      overallProgress: percent,
      currentWeekIndex,
      currentDayIndex,
    },
    program: {
      id: program.id,
      title: program.title,
      description: program.description,
      category: program.category,
      difficulty: program.difficulty,
      durationWeeks: program.durationWeeks,
      trainingMode: program.trainingMode,
      status: program.status,
      updatedAt: program.updatedAt,
    },
    currentWeek: currentWeek
      ? { id: currentWeek.id, title: currentWeek.title, sortOrder: currentWeek.sortOrder, status: currentWeek.status }
      : null,
    currentDay: currentDay
      ? { id: currentDay.id, title: currentDay.title, sortOrder: currentDay.sortOrder, status: currentDay.status }
      : null,
    nextActivity: activities.next,
    currentActivity: activities.current,
    nextLearnActivity,
    progress: {
      completedRequired,
      totalRequired,
      completedWeight: totals.earned,
      totalWeight: totals.weight,
      completedItems: totals.completed,
      remainingItems: Math.max(totals.countable - totals.completed, 0),
      percent,
    },
    weeks,
    items,
    milestones,
    currentMilestone: currentMilestone ? { id: currentMilestone.id, title: currentMilestone.title } : null,
    finalExam: {
      configured: Boolean(finalQuiz),
      examId: finalQuiz?.id ?? null,
      title: finalQuiz?.title ?? null,
      eligible: Boolean(finalQuiz) && eligible,
      status: finalAccess.status,
      reason: finalAccess.reason,
      reasons,
      requirements: eligibilityRequirements,
    },
    quizAccess,
    assignmentAccess,
  };
}

function toSnapshot(view: ProgressComputation): ProgressSnapshot {
  return {
    percent: view.progress.percent,
    completedWeight: view.progress.completedWeight,
    totalWeight: view.progress.totalWeight,
    completedItems: view.progress.completedItems,
    remainingItems: view.progress.remainingItems,
    currentWeekIndex: view.enrollment.currentWeekIndex,
    currentDayIndex: view.enrollment.currentDayIndex,
    currentWeekTitle: view.currentWeek?.title ?? null,
    currentDayTitle: view.currentDay?.title ?? null,
    nextLearnActivity: view.nextLearnActivity,
    nextActivity: view.nextActivity,
    currentActivity: view.currentActivity,
    currentMilestone: view.currentMilestone,
    programUpdatedAt: view.program.updatedAt.toISOString(),
    computedAt: new Date().toISOString(),
  };
}

function parseSnapshot(value: Prisma.JsonValue | null | undefined): ProgressSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Partial<ProgressSnapshot>;
  if (typeof row.percent !== "number" || typeof row.programUpdatedAt !== "string") {
    return null;
  }
  return row as ProgressSnapshot;
}

function toLearnView(view: ProgressComputation) {
  return {
    enrollment: view.enrollment,
    program: {
      id: view.program.id,
      title: view.program.title,
      description: view.program.description,
      category: view.program.category,
      difficulty: view.program.difficulty,
      durationWeeks: view.program.durationWeeks,
      trainingMode: view.program.trainingMode,
      status: view.program.status,
    },
    currentWeek: view.currentWeek,
    currentDay: view.currentDay,
    nextActivity: toLearnPathActivity(view.nextActivity),
    progress: {
      completedRequired: view.progress.completedRequired,
      totalRequired: view.progress.totalRequired,
      percent: view.progress.percent,
      completedWeight: view.progress.completedWeight,
      totalWeight: view.progress.totalWeight,
      completedItems: view.progress.completedItems,
      remainingItems: view.progress.remainingItems,
    },
    weeks: view.weeks.map((week) => ({
      id: week.id,
      sortOrder: week.sortOrder,
      title: week.title,
      status: week.status,
      reason: week.reason,
      days: week.days,
      quizzes: week.quizzes,
    })),
    finalExam:
      view.finalExam.configured && view.finalExam.examId
        ? {
            id: view.finalExam.examId,
            title: view.finalExam.title ?? "Final exam",
            status: view.finalExam.status,
            reason: view.finalExam.reason,
          }
        : null,
  };
}

function toProgressView(view: ProgressComputation) {
  return {
    enrollment: view.enrollment,
    program: {
      id: view.program.id,
      title: view.program.title,
      description: view.program.description,
      category: view.program.category,
      difficulty: view.program.difficulty,
      durationWeeks: view.program.durationWeeks,
      trainingMode: view.program.trainingMode,
      status: view.program.status,
    },
    overall: {
      percent: view.progress.percent,
      completedWeight: view.progress.completedWeight,
      totalWeight: view.progress.totalWeight,
      completedItems: view.progress.completedItems,
      remainingItems: view.progress.remainingItems,
    },
    currentWeek: view.currentWeek,
    currentDay: view.currentDay,
    currentActivity: view.currentActivity,
    nextActivity: view.nextActivity,
    weekProgress: view.weeks.map((week) => ({
      id: week.id,
      sortOrder: week.sortOrder,
      title: week.title,
      status: week.status,
      reason: week.reason,
      percent: week.percent,
      gatingComplete: week.gatingComplete,
    })),
    items: view.items,
    milestones: view.milestones,
    currentMilestone: view.currentMilestone,
    finalExam: view.finalExam,
  };
}

function summaryFromSnapshot(
  enrollment: {
    id: string;
    status: EnrollmentStatus;
    program: ProgressComputation["program"] | { id: string; title: string; description: string; category: string; difficulty: string; durationWeeks: number; trainingMode: string; status: string };
    batch?: { id: string; name: string } | null;
  },
  snapshot: ProgressSnapshot,
) {
  return {
    id: enrollment.id,
    status: snapshot.percent >= 100 ? EnrollmentStatus.COMPLETED : EnrollmentStatus.ACTIVE,
    overallProgress: snapshot.percent,
    currentWeekIndex: snapshot.currentWeekIndex,
    currentDayIndex: snapshot.currentDayIndex,
    program: {
      id: enrollment.program.id,
      title: enrollment.program.title,
      description: enrollment.program.description,
      category: enrollment.program.category,
      difficulty: enrollment.program.difficulty,
      durationWeeks: enrollment.program.durationWeeks,
      trainingMode: enrollment.program.trainingMode,
      status: enrollment.program.status,
    },
    batch: enrollment.batch ? { id: enrollment.batch.id, name: enrollment.batch.name } : null,
    currentWeek: snapshot.currentWeekTitle
      ? { id: "", title: snapshot.currentWeekTitle, sortOrder: snapshot.currentWeekIndex, status: "AVAILABLE" as const }
      : null,
    currentDay: snapshot.currentDayTitle
      ? { id: "", title: snapshot.currentDayTitle, sortOrder: snapshot.currentDayIndex, status: "AVAILABLE" as const }
      : null,
    nextActivity: toLearnPathActivity(snapshot.nextActivity),
    progress: {
      completedRequired: snapshot.completedItems,
      totalRequired: snapshot.completedItems + snapshot.remainingItems,
      percent: snapshot.percent,
    },
  };
}

async function loadProgram(programId: string): Promise<ProgramTree> {
  const program = await programRepository.findTreeById(programId);
  if (!program) {
    throw ApiError.notFound("Program not found");
  }
  return program;
}

async function persist(enrollmentId: string, view: ProgressComputation) {
  await enrollmentRepository.updateProgress(enrollmentId, {
    overallProgress: view.progress.percent,
    currentWeekIndex: view.enrollment.currentWeekIndex,
    currentDayIndex: view.enrollment.currentDayIndex,
    status: view.progress.percent >= 100 ? EnrollmentStatus.COMPLETED : EnrollmentStatus.ACTIVE,
    progressSnapshot: toSnapshot(view),
  });
  await interventionService.evaluateEnrollment(enrollmentId);
  await achievementService.evaluateEnrollment(enrollmentId);
  const { certificateService } = await import("./certificate.service");
  await certificateService.issueIfEligible(enrollmentId);
}

export const progressService = {
  async requireEnrollment(userId: string, programId: string, batchId?: string) {
    await enrollmentService.ensureVisibleEnrollments(userId);
    const enrollment = await enrollmentRepository.findWithProgressFacts(programId, userId, batchId);
    if (!enrollment) {
      throw ApiError.notFound("Enrollment not found");
    }
    const program = await loadProgram(programId);
    if (!VISIBLE_STATUSES.includes(program.status)) {
      throw ApiError.forbidden("This program is not available yet");
    }
    return { enrollment, program };
  },

  factsFromEnrollment(enrollment: {
    completions: Array<{ itemType: string; itemId: string; completedAt?: Date }>;
    assessmentAttempts: Array<{
      quizId: string;
      status: Parameters<typeof buildFacts>[0]["attempts"][number]["status"];
      score: unknown;
      passed: boolean | null;
      submittedAt: Date | null;
    }>;
    assignmentSubmissions: Array<{
      assignmentId: string;
      status: Parameters<typeof buildFacts>[0]["submissions"][number]["status"];
      score: number | null;
      submittedAt: Date | null;
      gradedAt: Date | null;
    }>;
    attendances?: Array<{ status: AttendanceStatus }>;
  }): TraineeFacts {
    return buildFacts({
      completions: enrollment.completions,
      attempts: enrollment.assessmentAttempts.map((row) => ({
        quizId: row.quizId,
        status: row.status,
        score: toNumber(row.score),
        passed: row.passed,
        submittedAt: row.submittedAt,
      })),
      submissions: enrollment.assignmentSubmissions,
      attendanceStatuses: enrollment.attendances?.map((row) => row.status) ?? [],
    });
  },

  compute(program: ProgramTree, enrollmentId: string, facts: TraineeFacts, now = new Date()) {
    return computeEngine(program, enrollmentId, facts, now);
  },

  toLearnView,
  toProgressView,

  async getComputation(user: AuthUser, programId: string, batchId?: string) {
    const { enrollment, program } = await this.requireEnrollment(user.id, programId, batchId);
    const view = this.compute(program, enrollment.id, this.factsFromEnrollment(enrollment));
    await persist(enrollment.id, view);
    return view;
  },

  async getLearnView(user: AuthUser, programId: string, batchId?: string) {
    return toLearnView(await this.getComputation(user, programId, batchId));
  },

  async getProgressView(user: AuthUser, programId: string, batchId?: string) {
    return toProgressView(await this.getComputation(user, programId, batchId));
  },

  async getProgressViewForEnrollment(viewer: AuthUser, enrollmentId: string) {
    const enrollment = await enrollmentRepository.findFactsById(enrollmentId);
    if (!enrollment) {
      throw ApiError.notFound("Enrollment not found");
    }

    if (viewer.role === "TRAINEE") {
      if (enrollment.userId !== viewer.id) {
        throw ApiError.notFound("Enrollment not found");
      }
    } else if (viewer.role === "TRAINER") {
      await programService.requireTrainerOnProgram(viewer, enrollment.programId);
    } else if (!isProgramReviewer(viewer.role)) {
      throw ApiError.forbidden();
    }

    const program = await loadProgram(enrollment.programId);
    const view = this.compute(program, enrollment.id, this.factsFromEnrollment(enrollment));
    await persist(enrollment.id, view);
    return toProgressView(view);
  },

  async recomputeEnrollment(enrollmentId: string) {
    const enrollment = await enrollmentRepository.findFactsById(enrollmentId);
    if (!enrollment) {
      return;
    }
    const program = await loadProgram(enrollment.programId);
    const view = this.compute(program, enrollment.id, this.factsFromEnrollment(enrollment));
    await persist(enrollment.id, view);
    return view;
  },

  async listSummaries(userId: string) {
    await enrollmentService.ensureVisibleEnrollments(userId);
    const enrollments = await enrollmentRepository.findByUser(userId);
    const summaries = [];

    for (const enrollment of enrollments) {
      if (!VISIBLE_STATUSES.includes(enrollment.program.status)) {
        continue;
      }

      const snapshot = parseSnapshot(enrollment.progressSnapshot);
      const canUseSnapshot =
        snapshot &&
        snapshot.programUpdatedAt === enrollment.program.updatedAt.toISOString() &&
        enrollment.program.trainingMode === "PROGRESSION";

      if (canUseSnapshot) {
        summaries.push(summaryFromSnapshot(enrollment, snapshot));
        continue;
      }

      const withFacts = await enrollmentRepository.findFactsById(enrollment.id);
      const program = await loadProgram(enrollment.programId);
      const view = this.compute(program, enrollment.id, this.factsFromEnrollment(withFacts ?? {
        completions: [],
        assessmentAttempts: [],
        assignmentSubmissions: [],
      }));
      await persist(enrollment.id, view);
      summaries.push({
        id: enrollment.id,
        status: view.enrollment.status,
        overallProgress: view.progress.percent,
        currentWeekIndex: view.enrollment.currentWeekIndex,
        currentDayIndex: view.enrollment.currentDayIndex,
        program: toLearnView(view).program,
        batch: enrollment.batch ? { id: enrollment.batch.id, name: enrollment.batch.name } : null,
        currentWeek: view.currentWeek,
        currentDay: view.currentDay,
        nextActivity: toLearnPathActivity(view.nextActivity),
        progress: {
          completedRequired: view.progress.completedRequired,
          totalRequired: view.progress.totalRequired,
          percent: view.progress.percent,
        },
      });
    }

    return summaries;
  },

  async listProgress(userId: string) {
    const summaries = await this.listSummaries(userId);
    const detailed = [];
    for (const summary of summaries) {
      const enrollment = await enrollmentRepository.findFactsById(summary.id);
      if (!enrollment) {
        continue;
      }
      const snapshot = parseSnapshot(enrollment.progressSnapshot);
      const canUseSnapshot =
        snapshot &&
        snapshot.programUpdatedAt === enrollment.program.updatedAt.toISOString() &&
        enrollment.program.trainingMode === "PROGRESSION";
      if (canUseSnapshot) {
        detailed.push({
          ...summary,
          overall: {
            percent: snapshot.percent,
            completedWeight: snapshot.completedWeight,
            totalWeight: snapshot.totalWeight,
            completedItems: snapshot.completedItems,
            remainingItems: snapshot.remainingItems,
          },
          currentActivity: snapshot.currentActivity,
          nextActivity: snapshot.nextActivity,
          currentMilestone: snapshot.currentMilestone,
        });
        continue;
      }
      const program = await loadProgram(summary.program.id);
      const view = this.compute(program, enrollment.id, this.factsFromEnrollment(enrollment));
      await persist(enrollment.id, view);
      const payload = toProgressView(view);
      detailed.push({
        id: enrollment.id,
        status: payload.enrollment.status,
        overallProgress: payload.overall.percent,
        program: payload.program,
        overall: payload.overall,
        currentWeek: payload.currentWeek,
        currentActivity: payload.currentActivity,
        nextActivity: payload.nextActivity,
        currentMilestone: payload.currentMilestone,
      });
    }
    return detailed;
  },

  quizAccess(view: ProgressComputation, quizId: string): AccessResult {
    return view.quizAccess.get(quizId) ?? { status: "LOCKED", available: false, reason: "This assessment is not available." };
  },

  assignmentAccess(view: ProgressComputation, assignmentId: string): AccessResult {
    return (
      view.assignmentAccess.get(assignmentId) ?? {
        status: "LOCKED",
        available: false,
        reason: "This assignment is not available.",
      }
    );
  },
};

