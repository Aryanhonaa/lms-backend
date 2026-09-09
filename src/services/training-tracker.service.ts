import {
  EnrollmentStatus,
  ProgramStatus,
  ProgramTrainerRole,
  Role,
  TrackerAttritionKind,
  TrackerTniDecision,
  TrackerTniStatus,
  TrackerTraineeStatus,
  TrainingBatchStatus,
  type NhtAttrition,
  type NhtLcaAudit,
  type NhtTniCase,
  type NhtTrainee,
} from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";
import {
  DAY7_WORKING_DAYS,
  HR_ATTRITION_WORKING_DAYS,
  LATE_JOIN_WORKING_DAYS,
  TRAINING_WORKING_DAYS,
  TNI_SCORE_THRESHOLD,
  addWorkingDays,
  buildBatchCode,
  countWorkingDaysInclusive,
  currentTrainingDay,
  dateOnly,
  safePercent,
} from "../utils/working-days";

const person = { select: { id: true, name: true, email: true, role: true } } as const;
const courseSelect = { select: { id: true, title: true, status: true } } as const;
const COURSE_READY: ProgramStatus[] = [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED];
const NHT_ROSTER_CAPACITY = 500;

const OPEN_TNI = new Set<TrackerTniStatus>([
  TrackerTniStatus.OPEN,
  TrackerTniStatus.IN_SUPPORT,
  TrackerTniStatus.REAUDIT_PENDING,
  TrackerTniStatus.PERFORMANCE_WARNING,
  TrackerTniStatus.SUPERVISOR_REVIEW,
]);

type TraineeRow = NhtTrainee & {
  user: { id: string; name: string; email: string; role: Role };
  trainer: { id: string; name: string; email: string; role: Role } | null;
  attritions: NhtAttrition[];
  audits: NhtLcaAudit[];
  tniCases: NhtTniCase[];
  batch: {
    id: string;
    code: string;
    process: string;
    trainingStartDate: Date;
    salesTrainer: { id: string; name: string; email: string; role: Role };
  } | null;
};

function requireStaff(user: AuthUser) {
  if (user.role === Role.TRAINEE) {
    throw ApiError.forbidden();
  }
}

/** Day-to-day batch ops: create batches, add people, scores, support plans. */
function isTrackerOperator(user: AuthUser): boolean {
  return user.role === Role.TRAINER;
}

/** Org-wide visibility + privileged decisions (e.g. termination). */
function isTrackerOverseer(user: AuthUser): boolean {
  return isProgramReviewer(user.role);
}

function requireOperator(user: AuthUser) {
  requireStaff(user);
  if (!isTrackerOperator(user)) {
    throw ApiError.forbidden("Only trainers can perform this action. Admins oversee batches; trainers run them.");
  }
}

function trainerBatchWhere(userId: string) {
  return {
    OR: [{ salesTrainerId: userId }, { filesTrainerId: userId }, { createdByUserId: userId }],
  };
}

function trainerTraineeWhere(userId: string) {
  return {
    OR: [
      { trainerId: userId },
      { batch: { is: trainerBatchWhere(userId) } },
    ],
  };
}

function canAccessBatchRow(
  user: AuthUser,
  batch: { salesTrainerId: string; filesTrainerId: string | null; createdByUserId: string },
): boolean {
  if (isTrackerOverseer(user)) {
    return true;
  }
  if (!isTrackerOperator(user)) {
    return false;
  }
  return batch.salesTrainerId === user.id || batch.filesTrainerId === user.id || batch.createdByUserId === user.id;
}

async function assertBatchAccess(user: AuthUser, batchId: string) {
  const batch = await prisma.nhtBatch.findUnique({
    where: { id: batchId },
    select: { id: true, salesTrainerId: true, filesTrainerId: true, createdByUserId: true },
  });
  if (!batch) {
    throw ApiError.notFound("Batch not found");
  }
  if (!canAccessBatchRow(user, batch)) {
    throw ApiError.forbidden("You can only work with batches you train on.");
  }
  return batch;
}

async function assertTraineeAccess(user: AuthUser, traineeId: string) {
  const trainee = await loadTrainee(traineeId);
  if (isTrackerOverseer(user)) {
    return trainee;
  }
  if (!isTrackerOperator(user)) {
    throw ApiError.forbidden();
  }
  const ownsTrainee = trainee.trainerId === user.id;
  if (ownsTrainee) {
    return trainee;
  }
  if (trainee.batchId) {
    const batch = await prisma.nhtBatch.findFirst({
      where: { id: trainee.batchId, ...trainerBatchWhere(user.id) },
      select: { id: true },
    });
    if (batch) {
      return trainee;
    }
  }
  throw ApiError.forbidden("You can only work with people on your batches.");
}

export function trackerCapabilities(user: AuthUser) {
  return {
    canOperate: isTrackerOperator(user),
    canTerminate: isTrackerOverseer(user),
    canViewAll: isTrackerOverseer(user),
  };
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function deriveStatus(row: {
  terminationConfirmed: boolean;
  attritions: Array<{ kind: TrackerAttritionKind }>;
  tniCases: Array<{ status: TrackerTniStatus }>;
  examEligible: boolean;
  examAppeared: boolean;
  examPassed: boolean;
  handoverDate: Date | null;
  batchId: string | null;
}): TrackerTraineeStatus {
  if (row.terminationConfirmed) {
    return TrackerTraineeStatus.TERMINATED;
  }
  if (row.attritions.some((item) => item.kind === TrackerAttritionKind.HR)) {
    return TrackerTraineeStatus.HR_ATTRITION;
  }
  if (row.attritions.some((item) => item.kind === TrackerAttritionKind.TRAINING)) {
    return TrackerTraineeStatus.TRAINING_ATTRITION;
  }
  if (row.tniCases.some((item) => OPEN_TNI.has(item.status))) {
    return TrackerTraineeStatus.TNI;
  }
  if (row.handoverDate) {
    return TrackerTraineeStatus.HANDED_OVER;
  }
  if (row.examPassed) {
    return TrackerTraineeStatus.HANDOVER_PENDING;
  }
  if (row.examAppeared && !row.examPassed) {
    return TrackerTraineeStatus.EXAM_FAILED;
  }
  if (row.examEligible && !row.examAppeared) {
    return TrackerTraineeStatus.EXAM_PENDING;
  }
  if (row.examEligible) {
    return TrackerTraineeStatus.EXAM_ELIGIBLE;
  }
  if (!row.batchId) {
    return TrackerTraineeStatus.ACTIVE;
  }
  return TrackerTraineeStatus.IN_TRAINING;
}

/** Client-facing outcome buckets (exclusive). */
export type OutcomeCategory =
  | "ACTIVE"
  | "COMPLETED_CERTIFIED"
  | "COMPLETED_NOT_CERTIFIED"
  | "LEFT_MID_BATCH"
  | "TERMINATED";

function deriveOutcomeCategory(status: TrackerTraineeStatus): OutcomeCategory {
  if (status === TrackerTraineeStatus.TERMINATED) {
    return "TERMINATED";
  }
  if (status === TrackerTraineeStatus.HR_ATTRITION || status === TrackerTraineeStatus.TRAINING_ATTRITION) {
    return "LEFT_MID_BATCH";
  }
  if (
    status === TrackerTraineeStatus.HANDED_OVER ||
    status === TrackerTraineeStatus.HANDOVER_PENDING ||
    status === TrackerTraineeStatus.CERTIFIED
  ) {
    return "COMPLETED_CERTIFIED";
  }
  if (status === TrackerTraineeStatus.EXAM_FAILED) {
    return "COMPLETED_NOT_CERTIFIED";
  }
  return "ACTIVE";
}

function deriveCompletionStatus(outcome: OutcomeCategory): "IN_PROGRESS" | "COMPLETED" | "LEFT" | "TERMINATED" {
  if (outcome === "TERMINATED") {
    return "TERMINATED";
  }
  if (outcome === "LEFT_MID_BATCH") {
    return "LEFT";
  }
  if (outcome === "COMPLETED_CERTIFIED" || outcome === "COMPLETED_NOT_CERTIFIED") {
    return "COMPLETED";
  }
  return "IN_PROGRESS";
}

function deriveCertificationStatus(
  outcome: OutcomeCategory,
  row: { examAppeared: boolean; examPassed: boolean },
): "PENDING" | "CERTIFIED" | "NOT_CERTIFIED" | "NOT_APPLICABLE" {
  if (outcome === "LEFT_MID_BATCH" || outcome === "TERMINATED") {
    return "NOT_APPLICABLE";
  }
  if (row.examPassed) {
    return "CERTIFIED";
  }
  if (row.examAppeared) {
    return "NOT_CERTIFIED";
  }
  return "PENDING";
}

function metricWithPercent(count: number, total: number) {
  return { count, percent: safePercent(count, total) };
}

function outcomeSummaryFromRows(
  rows: Array<{
    status: TrackerTraineeStatus;
    joiningDate: Date;
    batch: { trainingStartDate: Date } | null;
  }>,
) {
  const total = rows.length;
  const categories = rows.map((row) => deriveOutcomeCategory(row.status));
  const active = categories.filter((item) => item === "ACTIVE").length;
  const completedCertified = categories.filter((item) => item === "COMPLETED_CERTIFIED").length;
  const completedNotCertified = categories.filter((item) => item === "COMPLETED_NOT_CERTIFIED").length;
  const leftMidBatch = categories.filter((item) => item === "LEFT_MID_BATCH").length;
  const terminated = categories.filter((item) => item === "TERMINATED").length;
  const joinedMidBatch = rows.filter((row) => {
    if (!row.batch) {
      return false;
    }
    return countWorkingDaysInclusive(row.batch.trainingStartDate, row.joiningDate) > 1;
  }).length;
  return {
    totalEnrolled: total,
    active: metricWithPercent(active, total),
    completedCertified: metricWithPercent(completedCertified, total),
    completedNotCertified: metricWithPercent(completedNotCertified, total),
    leftMidBatch: metricWithPercent(leftMidBatch, total),
    joinedMidBatch: metricWithPercent(joinedMidBatch, total),
    terminated: metricWithPercent(terminated, total),
  };
}

function traineeMetrics(trainees: TraineeRow[]) {
  const hrAttrition = trainees.filter((row) => row.status === TrackerTraineeStatus.HR_ATTRITION).length;
  const trainingAttrition = trainees.filter((row) => row.status === TrackerTraineeStatus.TRAINING_ATTRITION).length;
  const active = trainees.filter(
    (row) => row.status !== TrackerTraineeStatus.HR_ATTRITION && row.status !== TrackerTraineeStatus.TRAINING_ATTRITION && row.status !== TrackerTraineeStatus.TERMINATED,
  ).length;
  const examEligible = trainees.filter((row) => row.examEligible).length;
  const appeared = trainees.filter((row) => row.examAppeared).length;
  const certified = trainees.filter((row) => row.examPassed).length;
  const failed = trainees.filter((row) => row.examAppeared && !row.examPassed).length;
  const handedOver = trainees.filter((row) => Boolean(row.handoverDate)).length;
  return {
    currentHc: active,
    hrAttrition,
    trainingAttrition,
    examEligible,
    appeared,
    certified,
    failed,
    certifiedPercent: safePercent(certified, appeared),
    handedOver,
    handoverPending: Math.max(certified - handedOver, 0),
  };
}

async function courseProgressByUser(batchId: string, userIds: string[]) {
  const map = new Map<string, number | null>();
  if (userIds.length === 0) {
    return map;
  }
  const links = await prisma.nhtBatchProgram.findMany({ where: { batchId }, select: { programBatchId: true } });
  if (links.length === 0) {
    for (const id of userIds) {
      map.set(id, null);
    }
    return map;
  }
  const enrollments = await prisma.enrollment.findMany({
    where: {
      userId: { in: userIds },
      batchId: { in: links.map((row) => row.programBatchId) },
      status: { not: EnrollmentStatus.WITHDRAWN },
    },
    select: { userId: true, overallProgress: true },
  });
  const buckets = new Map<string, number[]>();
  for (const row of enrollments) {
    const list = buckets.get(row.userId) ?? [];
    list.push(toNumber(row.overallProgress));
    buckets.set(row.userId, list);
  }
  for (const id of userIds) {
    const scores = buckets.get(id);
    if (!scores || scores.length === 0) {
      map.set(id, null);
    } else {
      map.set(id, Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length));
    }
  }
  return map;
}

function serializeTrainee(row: TraineeRow, courseCompletionPercent: number | null = null) {
  const latestTni = row.tniCases[0] ?? null;
  const avg =
    row.audits.length === 0
      ? null
      : Math.round((row.audits.reduce((sum, item) => sum + toNumber(item.score), 0) / row.audits.length) * 10) / 10;
  const outcomeCategory = deriveOutcomeCategory(row.status);
  const latestAttrition = row.attritions[0] ?? null;
  const exitDate = row.terminationConfirmed
    ? row.terminatedAt
    : latestAttrition
      ? latestAttrition.date
      : null;
  const exitReason = row.terminationConfirmed
    ? row.terminationReason || "Terminated"
    : latestAttrition
      ? latestAttrition.reason
      : null;
  const joinedMidBatch = row.batch
    ? countWorkingDaysInclusive(row.batch.trainingStartDate, row.joiningDate) > 1
    : false;
  return {
    id: row.id,
    user: row.user,
    batch: row.batch ? { id: row.batch.id, code: row.batch.code, process: row.batch.process } : null,
    process: row.process,
    trainer: row.trainer,
    team: row.team,
    supervisorName: row.supervisorName,
    joiningDate: row.joiningDate,
    enrollmentDate: row.joiningDate,
    status: row.status,
    outcomeCategory,
    completionStatus: deriveCompletionStatus(outcomeCategory),
    certificationStatus: deriveCertificationStatus(outcomeCategory, row),
    courseCompletionPercent,
    joinedMidBatch,
    exitDate,
    exitReason,
    examEligible: row.examEligible,
    examAppeared: row.examAppeared,
    examPassed: row.examPassed,
    examDate: row.examDate,
    examRemarks: row.examRemarks,
    handoverDate: row.handoverDate,
    handoverTeam: row.handoverTeam,
    handoverSupervisor: row.handoverSupervisor,
    handoverRemarks: row.handoverRemarks,
    attritions: row.attritions,
    audits: row.audits.map((item) => ({
      id: item.id,
      weekNumber: item.weekNumber,
      auditDate: item.auditDate,
      auditType: item.auditType,
      score: toNumber(item.score),
      remarks: item.remarks,
      isReAudit: item.isReAudit,
    })),
    averageAuditScore: avg,
    tni: latestTni
      ? {
          id: latestTni.id,
          status: latestTni.status,
          startDate: latestTni.startDate,
          identifiedGap: latestTni.identifiedGap,
          supportPlan: latestTni.supportPlan,
          supportStartDate: latestTni.supportStartDate,
          reviewDate: latestTni.reviewDate,
          trainerRemarks: latestTni.trainerRemarks,
          averageScore: toNumber(latestTni.averageScore),
          reAuditScore: latestTni.reAuditScore === null ? null : toNumber(latestTni.reAuditScore),
          finalDecision: latestTni.finalDecision,
        }
      : null,
  };
}

async function loadTrainee(id: string) {
  const row = await prisma.nhtTrainee.findUnique({
    where: { id },
    include: {
      user: person,
      trainer: person,
      attritions: { orderBy: { date: "desc" } },
      audits: { orderBy: { auditDate: "desc" } },
      tniCases: { orderBy: { createdAt: "desc" } },
      batch: { include: { salesTrainer: person } },
    },
  });
  if (!row) {
    throw ApiError.notFound("Trainee record not found");
  }
  return row;
}

async function refreshTrainee(id: string, now = new Date()) {
  const row = await loadTrainee(id);
  const start = row.batch?.trainingStartDate ?? row.joiningDate;
  const eligible =
    !row.terminationConfirmed &&
    !row.attritions.some((item) => item.kind === TrackerAttritionKind.HR || item.kind === TrackerAttritionKind.TRAINING) &&
    countWorkingDaysInclusive(row.joiningDate, now) >= TRAINING_WORKING_DAYS;
  const status = deriveStatus({
    ...row,
    examEligible: eligible || row.examEligible,
  });
  return prisma.nhtTrainee.update({
    where: { id },
    data: { examEligible: eligible || row.examEligible, status },
  });
}

async function refreshBatchSnapshots(batchId: string, actor: AuthUser, now = new Date()) {
  const batch = await prisma.nhtBatch.findUnique({
    where: { id: batchId },
    include: {
      trainees: { include: { attritions: true, audits: true, tniCases: true, user: person, trainer: person, batch: true } },
    },
  });
  if (!batch) {
    throw ApiError.notFound("Batch not found");
  }
  const day = currentTrainingDay(batch.trainingStartDate, now);
  const day1Hc = batch.trainees.filter(
    (row) => countWorkingDaysInclusive(batch.trainingStartDate, row.joiningDate) <= 1,
  ).length;
  let day7Hc = batch.day7Hc;
  let day7FinalizedAt = batch.day7FinalizedAt;
  if (day >= DAY7_WORKING_DAYS && day7Hc === null) {
    day7Hc = batch.trainees.filter((row) => !row.attritions.some((item) => item.kind === TrackerAttritionKind.HR)).length;
    day7FinalizedAt = now;
  }
  const completed = day >= TRAINING_WORKING_DAYS || Boolean(batch.actualCompletionDate);
  await prisma.nhtBatch.update({
    where: { id: batchId },
    data: {
      day1Hc: batch.day1Hc > 0 ? batch.day1Hc : day1Hc,
      day7Hc,
      day7FinalizedAt,
      status: completed ? TrainingBatchStatus.COMPLETED : TrainingBatchStatus.ONGOING,
      actualCompletionDate: completed ? (batch.actualCompletionDate ?? addWorkingDays(batch.trainingStartDate, TRAINING_WORKING_DAYS - 1)) : null,
    },
  });
  for (const trainee of batch.trainees) {
    await refreshTrainee(trainee.id, now);
  }
  void actor;
}

function batchSummary(
  batch: {
    id: string;
    month: number;
    year: number;
    batchNumber: number;
    code: string;
    process: string;
    trainingStartDate: Date;
    targetCompletionDate: Date;
    actualCompletionDate: Date | null;
    status: TrainingBatchStatus;
    day1Hc: number;
    day7Hc: number | null;
    salesTrainer: { id: string; name: string; email: string };
    filesTrainer: { id: string; name: string; email: string } | null;
    courses: Array<{ program: { id: string; title: string; status: ProgramStatus } }>;
    trainees: TraineeRow[];
  },
  now = new Date(),
) {
  const counts = traineeMetrics(batch.trainees);
  const day = currentTrainingDay(batch.trainingStartDate, now);
  const day7 = batch.day7Hc ?? counts.currentHc;
  const courses = batch.courses.map((row) => ({
    id: row.program.id,
    title: row.program.title,
    status: row.program.status,
  }));
  const outcomes = outcomeSummaryFromRows(
    batch.trainees.map((row) => ({
      status: row.status,
      joiningDate: row.joiningDate,
      batch: { trainingStartDate: batch.trainingStartDate },
    })),
  );
  return {
    id: batch.id,
    month: batch.month,
    year: batch.year,
    batchNumber: batch.batchNumber,
    code: batch.code,
    process: batch.process,
    courses,
    course: courses[0] ?? null,
    trainingStartDate: batch.trainingStartDate,
    targetCompletionDate: batch.targetCompletionDate,
    actualCompletionDate: batch.actualCompletionDate,
    status: batch.status,
    trainingDay: day,
    trainingDayLabel: batch.status === TrainingBatchStatus.ONGOING ? `Day ${day} / ${TRAINING_WORKING_DAYS}` : "Completed",
    progressPercent: Math.round((day / TRAINING_WORKING_DAYS) * 100),
    salesTrainer: batch.salesTrainer,
    filesTrainer: batch.filesTrainer,
    day1Hc: batch.day1Hc,
    day7Hc: day7,
    ...counts,
    throughputPercent: safePercent(counts.certified, day7 ?? 0),
    outcomes,
  };
}

const batchInclude = {
  salesTrainer: person,
  filesTrainer: person,
  courses: {
    include: { program: courseSelect },
    orderBy: { createdAt: "asc" as const },
  },
  trainees: {
    include: {
      user: person,
      trainer: person,
      attritions: { orderBy: { date: "desc" } },
      audits: { orderBy: { auditDate: "desc" } },
      tniCases: { orderBy: { createdAt: "desc" } },
      batch: { include: { salesTrainer: person } },
    },
  },
} as const;

async function requireCoursesForBatch(programIds: string[], actor: AuthUser) {
  const uniqueIds = [...new Set(programIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw ApiError.badRequest("Select at least one approved course");
  }
  const programs = [];
  for (const programId of uniqueIds) {
    programs.push(await requireCourseForBatch(programId, actor));
  }
  return programs;
}

async function syncBatchCourses(params: {
  actor: AuthUser;
  batchId: string;
  code: string;
  programIds: string[];
  startDate: Date;
  endDate: Date;
  trainerIds: string[];
  replace: boolean;
}) {
  const programs = await requireCoursesForBatch(params.programIds, params.actor);
  if (params.replace) {
    await prisma.nhtBatchProgram.deleteMany({ where: { batchId: params.batchId } });
  }
  const existing = params.replace
    ? []
    : await prisma.nhtBatchProgram.findMany({ where: { batchId: params.batchId } });
  const existingByProgram = new Map(existing.map((row) => [row.programId, row]));

  for (const program of programs) {
    const prior = existingByProgram.get(program.id);
    if (prior) {
      continue;
    }
    const roster = await ensureCourseRoster({
      programId: program.id,
      code: params.code,
      startDate: params.startDate,
      endDate: params.endDate,
      createdByUserId: params.actor.id,
    });
    await ensureTrainersOnCourse(program.id, params.trainerIds);
    await prisma.nhtBatchProgram.create({
      data: {
        batchId: params.batchId,
        programId: program.id,
        programBatchId: roster.id,
      },
    });
  }
}

async function requireCourseForBatch(programId: string, actor: AuthUser) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { trainers: { select: { userId: true } } },
  });
  if (!program) {
    throw ApiError.notFound("Course not found");
  }
  if (!COURSE_READY.includes(program.status)) {
    throw ApiError.badRequest("Pick an approved course. Draft or pending courses cannot be linked to a batch.");
  }
  if (actor.role === Role.TRAINER) {
    const onCourse = program.trainers.some((row) => row.userId === actor.id) || program.createdByUserId === actor.id;
    if (!onCourse) {
      throw ApiError.forbidden("You can only link batches to courses you train on.");
    }
  }
  return program;
}

async function ensureTrainersOnCourse(programId: string, trainerIds: string[]) {
  for (const userId of trainerIds) {
    if (!userId) {
      continue;
    }
    await prisma.programTrainer.upsert({
      where: { programId_userId: { programId, userId } },
      create: { programId, userId, role: ProgramTrainerRole.CO_TRAINER },
      update: {},
    });
  }
}

async function ensureCourseRoster(params: {
  programId: string;
  code: string;
  startDate: Date;
  endDate: Date;
  createdByUserId: string;
  existingProgramBatchId?: string | null;
}) {
  if (params.existingProgramBatchId) {
    const existing = await prisma.programBatch.findUnique({ where: { id: params.existingProgramBatchId } });
    if (existing && existing.programId === params.programId) {
      return existing;
    }
  }
  const byName = await prisma.programBatch.findUnique({
    where: { programId_name: { programId: params.programId, name: params.code } },
  });
  if (byName) {
    return byName;
  }
  return prisma.programBatch.create({
    data: {
      programId: params.programId,
      name: params.code,
      description: `Course access for new-hire batch ${params.code}`,
      capacity: NHT_ROSTER_CAPACITY,
      startDate: params.startDate,
      endDate: params.endDate,
      createdByUserId: params.createdByUserId,
    },
  });
}

async function enrollInLinkedCourse(params: {
  actorId: string;
  programId: string;
  programBatchId: string;
  traineeUserId: string;
}) {
  const existing = await enrollmentRepository.findEnrollment(params.programBatchId, params.traineeUserId);
  if (existing && existing.status !== EnrollmentStatus.WITHDRAWN) {
    return;
  }
  if (existing) {
    await enrollmentRepository.reactivate(existing.id, params.actorId);
    return;
  }
  await enrollmentRepository.create({
    programId: params.programId,
    userId: params.traineeUserId,
    enrolledByUserId: params.actorId,
    batchId: params.programBatchId,
  });
}

export const trainingTrackerService = {
  async options(user: AuthUser) {
    requireStaff(user);
    const courseWhere =
      user.role === Role.TRAINER
        ? {
            status: { in: COURSE_READY },
            OR: [{ createdByUserId: user.id }, { trainers: { some: { userId: user.id } } }],
          }
        : { status: { in: COURSE_READY } };
    const [trainers, trainees, courses] = await Promise.all([
      prisma.user.findMany({
        where: { role: Role.TRAINER, isActive: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
      prisma.user.findMany({
        where: { role: Role.TRAINEE, isActive: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
      prisma.program.findMany({
        where: courseWhere,
        select: { id: true, title: true, status: true },
        orderBy: { title: "asc" },
      }),
    ]);
    return { trainers, trainees, courses, capabilities: trackerCapabilities(user) };
  },

  async dashboard(user: AuthUser) {
    requireStaff(user);
    const batchWhere = isTrackerOperator(user) ? trainerBatchWhere(user.id) : {};
    const traineeWhere = isTrackerOperator(user) ? trainerTraineeWhere(user.id) : {};
    const [batches, trainees, tniCases] = await Promise.all([
      prisma.nhtBatch.findMany({ where: batchWhere, include: batchInclude, orderBy: { createdAt: "desc" } }),
      prisma.nhtTrainee.findMany({
        where: traineeWhere,
        include: {
          user: person,
          trainer: person,
          attritions: true,
          audits: true,
          tniCases: true,
          batch: { include: { salesTrainer: person } },
        },
      }),
      prisma.nhtTniCase.findMany({
        where: isTrackerOperator(user)
          ? {
              OR: [{ trainerId: user.id }, { trainee: { is: traineeWhere } }],
            }
          : {},
      }),
    ]);
    const summaries = batches.map((batch) => batchSummary(batch));
    const counts = traineeMetrics(trainees);
    const appeared = counts.appeared;
    const certified = counts.certified;
    const openTni = tniCases.filter((row) => OPEN_TNI.has(row.status)).length;
    const clearedTni = tniCases.filter((row) => row.status === TrackerTniStatus.CLEARED).length;
    const reviewTni = tniCases.filter(
      (row) => row.status === TrackerTniStatus.PERFORMANCE_WARNING || row.status === TrackerTniStatus.SUPERVISOR_REVIEW,
    ).length;
    const throughputs = summaries.map((row) => row.throughputPercent).filter((value): value is number => value !== null);
    const outcomes = outcomeSummaryFromRows(trainees);
    return {
      kpis: {
        totalBatches: summaries.length,
        activeBatches: summaries.filter((row) => row.status === "ONGOING").length,
        completedBatches: summaries.filter((row) => row.status === "COMPLETED").length,
        totalTrainees: trainees.length,
        currentTrainees: counts.currentHc,
        hrAttrition: counts.hrAttrition,
        trainingAttrition: counts.trainingAttrition,
        examAppeared: appeared,
        certified,
        certificationPercent: safePercent(certified, appeared),
        handoverPending: counts.handoverPending,
        averageThroughput:
          throughputs.length === 0 ? null : Math.round((throughputs.reduce((sum, value) => sum + value, 0) / throughputs.length) * 10) / 10,
        tniCount: openTni,
      },
      outcomes,
      batchProgress: summaries.filter((row) => row.status === "ONGOING"),
      throughput: summaries.map((row) => ({ id: row.id, code: row.code, throughputPercent: row.throughputPercent })),
      attrition: { hr: counts.hrAttrition, training: counts.trainingAttrition },
      certification: { appeared, certified, handedOver: counts.handedOver },
      tni: { open: openTni, cleared: clearedTni, review: reviewTni },
    };
  },

  async listBatches(
    user: AuthUser,
    query: {
      month?: number;
      year?: number;
      process?: string;
      trainerId?: string;
      status?: string;
      programId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    requireStaff(user);
    const batches = await prisma.nhtBatch.findMany({
      where: {
        ...(isTrackerOperator(user) ? trainerBatchWhere(user.id) : {}),
        ...(query.month ? { month: query.month } : {}),
        ...(query.year ? { year: query.year } : {}),
        ...(query.process === "VOICE_SALES" || query.process === "NON_VOICE_SALES_SUPPORT" ? { process: query.process } : {}),
        ...(query.trainerId
          ? {
              OR: [{ salesTrainerId: query.trainerId }, { filesTrainerId: query.trainerId }],
            }
          : {}),
        ...(query.status === "ONGOING" || query.status === "COMPLETED" ? { status: query.status } : {}),
        ...(query.programId ? { courses: { some: { programId: query.programId } } } : {}),
        ...(query.dateFrom || query.dateTo
          ? {
              trainingStartDate: {
                ...(query.dateFrom ? { gte: dateOnly(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: dateOnly(query.dateTo) } : {}),
              },
            }
          : {}),
      },
      include: batchInclude,
      orderBy: [{ year: "desc" }, { month: "desc" }, { batchNumber: "asc" }],
    });
    return { batches: batches.map((batch) => batchSummary(batch)) };
  },

  async getBatch(user: AuthUser, batchId: string) {
    requireStaff(user);
    await assertBatchAccess(user, batchId);
    await refreshBatchSnapshots(batchId, user);
    const batch = await prisma.nhtBatch.findUnique({ where: { id: batchId }, include: batchInclude });
    if (!batch) {
      throw ApiError.notFound("Batch not found");
    }
    const progressMap = await courseProgressByUser(
      batchId,
      batch.trainees.map((row) => row.userId),
    );
    return {
      batch: batchSummary(batch),
      trainees: batch.trainees.map((row) => serializeTrainee(row, progressMap.get(row.userId) ?? null)),
    };
  },

  async createBatch(
    user: AuthUser,
    input: {
      month: number;
      year: number;
      batchNumber: number;
      process: "VOICE_SALES" | "NON_VOICE_SALES_SUPPORT";
      programId?: string;
      programIds?: string[];
      trainingStartDate: string;
      targetCompletionDate: string;
      salesTrainerId: string;
      filesTrainerId?: string | null;
    },
  ) {
    requireOperator(user);
    const programIds = input.programIds?.length ? input.programIds : input.programId ? [input.programId] : [];
    await requireCoursesForBatch(programIds, user);
    const salesTrainerId = user.id;
    const salesTrainer = await prisma.user.findUnique({ where: { id: salesTrainerId } });
    if (!salesTrainer || salesTrainer.role !== Role.TRAINER) {
      throw ApiError.badRequest("Sales trainer must be an active trainer");
    }
    if (input.filesTrainerId) {
      const filesTrainer = await prisma.user.findUnique({ where: { id: input.filesTrainerId } });
      if (!filesTrainer || filesTrainer.role !== Role.TRAINER) {
        throw ApiError.badRequest("Files trainer must be an active trainer");
      }
    }
    const start = dateOnly(input.trainingStartDate);
    const target = dateOnly(input.targetCompletionDate);
    const code = buildBatchCode(input.month, input.year, input.batchNumber);
    try {
      const created = await prisma.nhtBatch.create({
        data: {
          month: input.month,
          year: input.year,
          batchNumber: input.batchNumber,
          code,
          process: input.process,
          trainingStartDate: start,
          targetCompletionDate: target,
          salesTrainerId,
          filesTrainerId: input.filesTrainerId ?? null,
          createdByUserId: user.id,
        },
      });
      try {
        await syncBatchCourses({
          actor: user,
          batchId: created.id,
          code,
          programIds,
          startDate: start,
          endDate: target,
          trainerIds: [salesTrainerId, input.filesTrainerId ?? ""],
          replace: true,
        });
      } catch (linkError) {
        await prisma.nhtBatch.delete({ where: { id: created.id } }).catch(() => undefined);
        throw linkError;
      }
      return this.getBatch(user, created.id);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw ApiError.conflict("A batch with that month, year, and number already exists");
    }
  },

  async updateBatch(
    user: AuthUser,
    batchId: string,
    input: {
      programId?: string;
      programIds?: string[];
      targetCompletionDate?: string;
      actualCompletionDate?: string | null;
      salesTrainerId?: string;
      filesTrainerId?: string | null;
      status?: "ONGOING" | "COMPLETED";
      day1Hc?: number;
      day7Hc?: number | null;
    },
  ) {
    requireOperator(user);
    await assertBatchAccess(user, batchId);
    const batch = await prisma.nhtBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      throw ApiError.notFound("Batch not found");
    }
    if (input.day7Hc !== undefined && batch.day7FinalizedAt) {
      throw ApiError.forbidden("Day 7 headcount is finalized");
    }

    const programIds = input.programIds?.length
      ? input.programIds
      : input.programId
        ? [input.programId]
        : null;

    await prisma.nhtBatch.update({
      where: { id: batchId },
      data: {
        ...(input.targetCompletionDate ? { targetCompletionDate: dateOnly(input.targetCompletionDate) } : {}),
        ...(input.actualCompletionDate !== undefined
          ? { actualCompletionDate: input.actualCompletionDate ? dateOnly(input.actualCompletionDate) : null }
          : {}),
        ...(input.salesTrainerId ? { salesTrainerId: input.salesTrainerId } : {}),
        ...(input.filesTrainerId !== undefined ? { filesTrainerId: input.filesTrainerId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.day1Hc !== undefined ? { day1Hc: input.day1Hc } : {}),
        ...(input.day7Hc !== undefined ? { day7Hc: input.day7Hc, day7FinalizedAt: input.day7Hc === null ? null : new Date() } : {}),
      },
    });

    if (programIds) {
      await syncBatchCourses({
        actor: user,
        batchId,
        code: batch.code,
        programIds,
        startDate: batch.trainingStartDate,
        endDate: input.targetCompletionDate ? dateOnly(input.targetCompletionDate) : batch.targetCompletionDate,
        trainerIds: [
          input.salesTrainerId ?? batch.salesTrainerId,
          (input.filesTrainerId !== undefined ? input.filesTrainerId : batch.filesTrainerId) ?? "",
        ],
        replace: true,
      });
    }

    return this.getBatch(user, batchId);
  },

  async addTrainee(
    user: AuthUser,
    batchId: string,
    input: { userId: string; joiningDate: string; team?: string; supervisorName?: string; trainerId?: string | null },
  ) {
    requireOperator(user);
    await assertBatchAccess(user, batchId);
    const batch = await prisma.nhtBatch.findUnique({
      where: { id: batchId },
      include: { courses: true },
    });
    if (!batch) {
      throw ApiError.notFound("Batch not found");
    }
    const joining = dateOnly(input.joiningDate);
    const offset = countWorkingDaysInclusive(batch.trainingStartDate, joining);
    if (offset > LATE_JOIN_WORKING_DAYS) {
      throw ApiError.badRequest("New joiners can only be added within the first 3 working days");
    }
    const candidate = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!candidate) {
      throw ApiError.notFound("User not found");
    }
    if (candidate.role !== Role.TRAINEE) {
      throw ApiError.badRequest("Only trainees can be added to a batch");
    }
    const alreadyInBatch = await prisma.nhtTrainee.findFirst({ where: { userId: input.userId, batchId } });
    if (alreadyInBatch) {
      throw ApiError.conflict("This person is already in the batch");
    }
    const activeElsewhere = await prisma.nhtTrainee.findFirst({
      where: {
        userId: input.userId,
        batchId: { not: null },
        status: {
          in: [
            TrackerTraineeStatus.JOINED,
            TrackerTraineeStatus.IN_TRAINING,
            TrackerTraineeStatus.EXAM_ELIGIBLE,
            TrackerTraineeStatus.EXAM_PENDING,
            TrackerTraineeStatus.TNI,
            TrackerTraineeStatus.HANDOVER_PENDING,
          ],
        },
      },
    });
    if (activeElsewhere) {
      throw ApiError.conflict("This person is already in an active new-hire batch");
    }
    const created = await prisma.nhtTrainee.create({
      data: {
        userId: input.userId,
        batchId,
        process: batch.process,
        trainerId: input.trainerId ?? batch.salesTrainerId,
        team: input.team ?? "",
        supervisorName: input.supervisorName ?? "",
        joiningDate: joining,
        status: TrackerTraineeStatus.IN_TRAINING,
      },
    });

    for (const link of batch.courses) {
      await enrollInLinkedCourse({
        actorId: user.id,
        programId: link.programId,
        programBatchId: link.programBatchId,
        traineeUserId: input.userId,
      });
    }

    await refreshBatchSnapshots(batchId, user);
    return { trainee: serializeTrainee(await loadTrainee(created.id)) };
  },

  async addStandaloneTrainee(
    user: AuthUser,
    input: {
      userId: string;
      process: "VOICE_SALES" | "NON_VOICE_SALES_SUPPORT";
      joiningDate: string;
      team?: string;
      supervisorName?: string;
      trainerId?: string | null;
    },
  ) {
    requireOperator(user);
    const candidate = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!candidate) {
      throw ApiError.notFound("User not found");
    }
    const created = await prisma.nhtTrainee.create({
      data: {
        userId: input.userId,
        process: input.process,
        trainerId: input.trainerId ?? user.id,
        team: input.team ?? "",
        supervisorName: input.supervisorName ?? "",
        joiningDate: dateOnly(input.joiningDate),
        status: TrackerTraineeStatus.ACTIVE,
      },
    });
    await refreshTrainee(created.id);
    return { trainee: serializeTrainee(await loadTrainee(created.id)) };
  },

  async listTrainees(user: AuthUser, query: { batchId?: string; trainerId?: string; process?: string; team?: string; status?: string }) {
    requireStaff(user);
    const rows = await prisma.nhtTrainee.findMany({
      where: {
        ...(isTrackerOperator(user) ? trainerTraineeWhere(user.id) : {}),
        ...(query.batchId ? { batchId: query.batchId } : {}),
        ...(query.trainerId ? { trainerId: query.trainerId } : {}),
        ...(query.process === "VOICE_SALES" || query.process === "NON_VOICE_SALES_SUPPORT" ? { process: query.process } : {}),
        ...(query.team ? { team: { contains: query.team, mode: "insensitive" } } : {}),
        ...(query.status ? { status: query.status as TrackerTraineeStatus } : {}),
      },
      include: {
        user: person,
        trainer: person,
        attritions: { orderBy: { date: "desc" } },
        audits: { orderBy: { auditDate: "desc" } },
        tniCases: { orderBy: { createdAt: "desc" } },
        batch: { include: { salesTrainer: person } },
      },
      orderBy: { joiningDate: "desc" },
    });
    return { trainees: rows.map(serializeTrainee) };
  },

  async recordAttrition(
    user: AuthUser,
    traineeId: string,
    input: { kind: "HR" | "TRAINING"; date: string; reason: string; remarks?: string },
  ) {
    requireOperator(user);
    const trainee = await assertTraineeAccess(user, traineeId);
    const date = dateOnly(input.date);
    const start = trainee.batch?.trainingStartDate ?? trainee.joiningDate;
    const days = countWorkingDaysInclusive(start, date);
    if (input.kind === "HR" && days > HR_ATTRITION_WORKING_DAYS) {
      throw ApiError.badRequest("HR attrition applies only within the first 3 working days");
    }
    if (input.kind === "TRAINING" && days <= HR_ATTRITION_WORKING_DAYS) {
      throw ApiError.badRequest("Use HR attrition for exits within the first 3 working days");
    }
    await prisma.nhtAttrition.create({
      data: {
        traineeId,
        kind: input.kind,
        date,
        reason: input.reason,
        remarks: input.remarks ?? "",
        recordedByUserId: user.id,
      },
    });
    if (trainee.batchId) {
      await refreshBatchSnapshots(trainee.batchId, user);
    } else {
      await refreshTrainee(traineeId);
    }
    return { trainee: serializeTrainee(await loadTrainee(traineeId)) };
  },

  async recordExam(
    user: AuthUser,
    traineeId: string,
    input: { appeared: boolean; passed?: boolean; examDate?: string; remarks?: string },
  ) {
    requireOperator(user);
    const trainee = await assertTraineeAccess(user, traineeId);
    if (!trainee.examEligible) {
      throw ApiError.badRequest("This trainee is not yet exam eligible");
    }
    if (input.appeared && input.passed === undefined) {
      throw ApiError.badRequest("Pass or fail is required when the trainee appeared");
    }
    await prisma.nhtTrainee.update({
      where: { id: traineeId },
      data: {
        examAppeared: input.appeared,
        examPassed: Boolean(input.appeared && input.passed),
        examDate: input.examDate ? dateOnly(input.examDate) : dateOnly(new Date()),
        examRemarks: input.remarks ?? "",
      },
    });
    if (trainee.batchId) {
      await refreshBatchSnapshots(trainee.batchId, user);
    } else {
      await refreshTrainee(traineeId);
    }
    return { trainee: serializeTrainee(await loadTrainee(traineeId)) };
  },

  async recordHandover(
    user: AuthUser,
    traineeId: string,
    input: { handoverDate: string; team: string; supervisorName?: string; remarks?: string },
  ) {
    requireOperator(user);
    const trainee = await assertTraineeAccess(user, traineeId);
    if (!trainee.examPassed) {
      throw ApiError.badRequest("Only certified trainees can be handed over");
    }
    await prisma.nhtTrainee.update({
      where: { id: traineeId },
      data: {
        handoverDate: dateOnly(input.handoverDate),
        handoverTeam: input.team,
        handoverSupervisor: input.supervisorName ?? "",
        handoverRemarks: input.remarks ?? "",
        team: input.team,
        supervisorName: input.supervisorName ?? trainee.supervisorName,
      },
    });
    if (trainee.batchId) {
      await refreshBatchSnapshots(trainee.batchId, user);
    } else {
      await refreshTrainee(traineeId);
    }
    return { trainee: serializeTrainee(await loadTrainee(traineeId)) };
  },

  async listAudits(user: AuthUser) {
    requireStaff(user);
    const audits = await prisma.nhtLcaAudit.findMany({
      where: isTrackerOperator(user)
        ? {
            OR: [
              { auditorUserId: user.id },
              { trainee: { is: trainerTraineeWhere(user.id) } },
            ],
          }
        : {},
      include: {
        trainee: {
          include: {
            user: person,
            trainer: person,
            batch: { include: { salesTrainer: person } },
            attritions: true,
            audits: true,
            tniCases: true,
          },
        },
        auditor: person,
      },
      orderBy: { auditDate: "desc" },
      take: 200,
    });
    return {
      audits: audits.map((row) => ({
        id: row.id,
        weekNumber: row.weekNumber,
        auditDate: row.auditDate,
        auditType: row.auditType,
        score: toNumber(row.score),
        remarks: row.remarks,
        isReAudit: row.isReAudit,
        auditor: row.auditor,
        trainee: serializeTrainee(row.trainee),
      })),
    };
  },

  async createAudit(
    user: AuthUser,
    input: {
      traineeId: string;
      weekNumber: number;
      auditDate: string;
      auditType: "CALL" | "CHAT";
      score: number;
      remarks?: string;
      isReAudit?: boolean;
    },
  ) {
    requireOperator(user);
    const trainee = await assertTraineeAccess(user, input.traineeId);
    await prisma.nhtLcaAudit.create({
      data: {
        traineeId: trainee.id,
        batchId: trainee.batchId,
        weekNumber: input.weekNumber,
        auditDate: dateOnly(input.auditDate),
        auditType: input.auditType,
        score: input.score,
        auditorUserId: user.id,
        remarks: input.remarks ?? "",
        isReAudit: Boolean(input.isReAudit),
      },
    });
    const audits = await prisma.nhtLcaAudit.findMany({ where: { traineeId: trainee.id } });
    const average = audits.reduce((sum, item) => sum + toNumber(item.score), 0) / audits.length;
    const open = trainee.tniCases.find((item) => OPEN_TNI.has(item.status));
    if (input.isReAudit && open) {
      const nextStatus =
        input.score >= TNI_SCORE_THRESHOLD ? TrackerTniStatus.CLEARED : TrackerTniStatus.PERFORMANCE_WARNING;
      await prisma.nhtTniCase.update({
        where: { id: open.id },
        data: {
          reAuditScore: input.score,
          status: nextStatus,
          finalDecision: nextStatus === TrackerTniStatus.CLEARED ? TrackerTniDecision.CLEARED : undefined,
          decisionAt: nextStatus === TrackerTniStatus.CLEARED ? new Date() : undefined,
          decidedByUserId: nextStatus === TrackerTniStatus.CLEARED ? user.id : undefined,
        },
      });
    } else if (average < TNI_SCORE_THRESHOLD && !open) {
      await prisma.nhtTniCase.create({
        data: {
          traineeId: trainee.id,
          batchId: trainee.batchId,
          startDate: dateOnly(input.auditDate),
          trainerId: trainee.trainerId ?? trainee.batch?.salesTrainer.id ?? user.id,
          averageScore: Math.round(average * 10) / 10,
          identifiedGap: `Average LCA score ${Math.round(average * 10) / 10}% is below ${TNI_SCORE_THRESHOLD}%`,
        },
      });
    } else if (open) {
      await prisma.nhtTniCase.update({
        where: { id: open.id },
        data: { averageScore: Math.round(average * 10) / 10 },
      });
    }
    if (trainee.batchId) {
      await refreshBatchSnapshots(trainee.batchId, user);
    } else {
      await refreshTrainee(trainee.id);
    }
    return { trainee: serializeTrainee(await loadTrainee(trainee.id)) };
  },

  async listTni(user: AuthUser) {
    requireStaff(user);
    const rows = await prisma.nhtTniCase.findMany({
      where: isTrackerOperator(user)
        ? {
            OR: [{ trainerId: user.id }, { trainee: { is: trainerTraineeWhere(user.id) } }],
          }
        : {},
      include: {
        trainee: {
          include: {
            user: person,
            trainer: person,
            batch: { include: { salesTrainer: person } },
            attritions: true,
            audits: true,
            tniCases: true,
          },
        },
        trainer: person,
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      cases: rows.map((row) => ({
        id: row.id,
        status: row.status,
        startDate: row.startDate,
        identifiedGap: row.identifiedGap,
        supportPlan: row.supportPlan,
        supportStartDate: row.supportStartDate,
        reviewDate: row.reviewDate,
        trainerRemarks: row.trainerRemarks,
        averageScore: toNumber(row.averageScore),
        reAuditScore: row.reAuditScore === null ? null : toNumber(row.reAuditScore),
        finalDecision: row.finalDecision,
        trainer: row.trainer,
        trainee: serializeTrainee(row.trainee),
      })),
    };
  },

  async updateTniSupport(
    user: AuthUser,
    tniId: string,
    input: {
      identifiedGap: string;
      trainerId?: string;
      supportPlan: string;
      supportStartDate: string;
      reviewDate: string;
      trainerRemarks?: string;
    },
  ) {
    requireOperator(user);
    const current = await prisma.nhtTniCase.findUnique({ where: { id: tniId } });
    if (!current) {
      throw ApiError.notFound("TNI case not found");
    }
    await assertTraineeAccess(user, current.traineeId);
    await prisma.nhtTniCase.update({
      where: { id: tniId },
      data: {
        identifiedGap: input.identifiedGap,
        trainerId: input.trainerId ?? current.trainerId,
        supportPlan: input.supportPlan,
        supportStartDate: dateOnly(input.supportStartDate),
        reviewDate: dateOnly(input.reviewDate),
        trainerRemarks: input.trainerRemarks ?? "",
        status: TrackerTniStatus.IN_SUPPORT,
      },
    });
    await refreshTrainee(current.traineeId);
    return this.listTni(user);
  },

  async decideTni(
    user: AuthUser,
    tniId: string,
    input: { decision: "CLEARED" | "CONTINUE_MONITORING" | "INTERNAL_TRANSFER" | "TERMINATED"; confirmTermination?: boolean; reason?: string },
  ) {
    requireStaff(user);
    const current = await prisma.nhtTniCase.findUnique({ where: { id: tniId } });
    if (!current) {
      throw ApiError.notFound("TNI case not found");
    }
    if (input.decision === TrackerTniDecision.TERMINATED) {
      if (!isTrackerOverseer(user) || !input.confirmTermination) {
        throw ApiError.forbidden("Termination requires an authorized admin confirmation");
      }
      await prisma.nhtTrainee.update({
        where: { id: current.traineeId },
        data: {
          terminationConfirmed: true,
          terminatedAt: new Date(),
          terminatedByUserId: user.id,
          terminationReason: input.reason ?? "",
        },
      });
    } else {
      requireOperator(user);
      await assertTraineeAccess(user, current.traineeId);
    }
    const statusMap: Record<TrackerTniDecision, TrackerTniStatus> = {
      CLEARED: TrackerTniStatus.CLEARED,
      CONTINUE_MONITORING: TrackerTniStatus.CONTINUE_MONITORING,
      INTERNAL_TRANSFER: TrackerTniStatus.INTERNAL_TRANSFER,
      TERMINATED: TrackerTniStatus.TERMINATED,
    };
    await prisma.nhtTniCase.update({
      where: { id: tniId },
      data: {
        finalDecision: input.decision,
        status: statusMap[input.decision],
        decisionAt: new Date(),
        decidedByUserId: user.id,
        trainerRemarks: input.reason ?? current.trainerRemarks,
      },
    });
    await refreshTrainee(current.traineeId);
    return this.listTni(user);
  },
};
