import {
  AssessmentAttemptStatus,
  BatchTrainerRole,
  EnrollmentStatus,
  LineOfBusiness,
  Prisma,
  ProgramStatus,
  QuizKind,
  Role,
  TrainingMode,
} from "../generated/prisma";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { batchService } from "./batch.service";
import {
  EVALUATION_DAY,
  HEADCOUNT_LOCK_DAY,
  JOIN_WINDOW_DAYS,
  batchTrainingStatus,
  classifyTrainee,
  combineFunnels,
  summarizeFunnel,
  trainingDay,
  type BatchTrainingStatus,
} from "./batch-funnel";
import { enrollmentActivity, enrollmentActivityCount } from "./enrollment-activity";
import { programService } from "./program.service";
import { workCalendarService } from "./work-calendar.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isExitedEnrollment } from "../utils/enrollment-status";
import { isProgramReviewer } from "../utils/roles";
import { zonedYmd } from "../utils/timezone";
import { TRAINING_WORKING_DAYS, addWorkingDays, type WorkCalendar } from "../utils/working-days";
import { isUuid } from "../validators/common";

export type TrackerFilters = {
  programId?: string;
  batchId?: string;
  trainerId?: string;
  lineOfBusiness?: LineOfBusiness;
  status?: BatchTrainingStatus;
  from?: string;
  to?: string;
  q?: string;
};

const FINISHED_ATTEMPTS = [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.TIMED_OUT];

const batchInclude = {
  program: { select: { id: true, title: true, trainingMode: true, updatedAt: true } },
  trainers: { include: { user: { select: { id: true, name: true, email: true } } } },
  enrollments: {
    where: { status: { not: EnrollmentStatus.REMOVED } },
    orderBy: { joinedAt: "asc" as const },
    select: {
      id: true,
      _count: enrollmentActivityCount,
      status: true,
      joinedAt: true,
      exitedAt: true,
      exitReason: true,
      courseOutcome: true,
      overallProgress: true,
      progressSnapshot: true,
      handedOverAt: true,
      user: { select: { id: true, name: true, email: true } },
      team: { select: { id: true, name: true } },
      exitedBy: { select: { id: true, name: true } },
      certificate: { select: { status: true, issuedAt: true, certificateId: true } },
      assessmentAttempts: {
        where: { status: { in: FINISHED_ATTEMPTS }, quiz: { kind: QuizKind.FINAL_EXAM } },
        orderBy: { submittedAt: "desc" as const },
        take: 1,
        select: { score: true, passed: true, needsReview: true, submittedAt: true },
      },
    },
  },
} satisfies Prisma.ProgramBatchInclude;

type TrackerBatchRow = Prisma.ProgramBatchGetPayload<{ include: typeof batchInclude }>;
type TrackerEnrollmentRow = TrackerBatchRow["enrollments"][number];

function ymd(date: Date | null | undefined): string | null {
  return date ? zonedYmd(date, env.timezone) : null;
}

function optionalUuid(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "" || value === null) {
    return undefined;
  }
  if (!isUuid(value)) {
    throw ApiError.badRequest(`Invalid ${label}`);
  }
  return value;
}

function optionalYmd(value: unknown, label: string): string | undefined {
  if (typeof value !== "string" || value === "") {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw ApiError.badRequest(`Invalid ${label}`);
  }
  return value;
}

export function parseTrackerFilters(query: Record<string, unknown>): TrackerFilters {
  const lob = query.lineOfBusiness;
  const status = query.status;
  return {
    programId: optionalUuid(query.programId, "programId"),
    batchId: optionalUuid(query.batchId, "batchId"),
    trainerId: optionalUuid(query.trainerId, "trainerId"),
    lineOfBusiness: lob === "VOICE" || lob === "NON_VOICE" ? lob : undefined,
    status: status === "UPCOMING" || status === "ONGOING" || status === "COMPLETED" ? status : undefined,
    from: optionalYmd(query.from, "from date"),
    to: optionalYmd(query.to, "to date"),
    q: typeof query.q === "string" && query.q.trim() ? query.q.trim().slice(0, 80) : undefined,
  };
}

async function scopeWhere(user: AuthUser): Promise<Prisma.ProgramBatchWhereInput> {
  if (isProgramReviewer(user.role)) {
    return { program: { status: { not: ProgramStatus.DRAFT } } };
  }
  if (user.role !== Role.TRAINER) {
    throw ApiError.forbidden();
  }
  const programIds = await programService.listProgramIdsForTrainer(user.id);
  return { OR: [{ programId: { in: programIds } }, { trainers: { some: { userId: user.id } } }] };
}

function filterWhere(filters: TrackerFilters): Prisma.ProgramBatchWhereInput[] {
  const where: Prisma.ProgramBatchWhereInput[] = [];
  if (filters.programId) {
    where.push({ programId: filters.programId });
  }
  if (filters.batchId) {
    where.push({ id: filters.batchId });
  }
  if (filters.trainerId) {
    where.push({ trainers: { some: { userId: filters.trainerId } } });
  }
  if (filters.lineOfBusiness) {
    where.push({ lineOfBusiness: filters.lineOfBusiness });
  }
  if (filters.from) {
    where.push({ startDate: { gte: new Date(`${filters.from}T00:00:00Z`) } });
  }
  if (filters.to) {
    where.push({ startDate: { lte: new Date(`${filters.to}T23:59:59Z`) } });
  }
  if (filters.q) {
    where.push({
      OR: [
        { code: { contains: filters.q, mode: "insensitive" } },
        { name: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  return where;
}

function isStale(row: TrackerEnrollmentRow, program: TrackerBatchRow["program"]): boolean {
  if (isExitedEnrollment(row.status)) {
    return false;
  }
  if (program.trainingMode === TrainingMode.SCHEDULED) {
    return true;
  }
  const snapshot = row.progressSnapshot as { programUpdatedAt?: unknown } | null;
  return !snapshot || snapshot.programUpdatedAt !== program.updatedAt.toISOString();
}

/** Recomputes stored progress for ongoing batches whose snapshot no longer matches the curriculum. */
async function refreshStaleProgress(batches: TrackerBatchRow[]): Promise<boolean> {
  const stale = batches
    .filter((batch) => !batch.actualCompletionDate)
    .flatMap((batch) => batch.enrollments.filter((row) => isStale(row, batch.program)).map((row) => row.id));
  if (stale.length === 0) {
    return false;
  }
  const { progressService } = await import("./progress.service");
  for (const enrollmentId of stale) {
    await progressService.recomputeEnrollment(enrollmentId);
  }
  return true;
}

function trainerRef(batch: TrackerBatchRow, role: BatchTrainerRole) {
  const user = batch.trainers.find((row) => row.role === role)?.user;
  return user ? { id: user.id, name: user.name } : null;
}

function buildBatch(batch: TrackerBatchRow, calendar: WorkCalendar, todayYmd: string) {
  const startYmd = ymd(batch.startDate);
  const funnelBatch = { startYmd, actualCompletionYmd: ymd(batch.actualCompletionDate) };
  const day = trainingDay(funnelBatch, todayYmd, calendar);
  const trainees = batch.enrollments.map((row) => {
    const exam = row.assessmentAttempts[0] ?? null;
    const classified = classifyTrainee(
      {
        status: row.status,
        joinedYmd: ymd(row.joinedAt) ?? todayYmd,
        exitedYmd: ymd(row.exitedAt),
        courseOutcome: row.courseOutcome,
        progress: Number(row.overallProgress),
        finalExamAttempted: Boolean(exam),
        certificateStatus: row.certificate?.status ?? null,
        handedOver: Boolean(row.handedOverAt),
      },
      funnelBatch,
      calendar,
      todayYmd,
    );
    return { row, exam, classified };
  });
  const funnel = summarizeFunnel(
    trainees.map((item) => item.classified),
    day >= HEADCOUNT_LOCK_DAY || funnelBatch.actualCompletionYmd !== null,
  );
  const milestoneDate = (n: number) => (startYmd ? addWorkingDays(startYmd, n, calendar) : null);

  return {
    summary: {
      id: batch.id,
      code: batch.code,
      name: batch.name,
      program: { id: batch.program.id, title: batch.program.title },
      lineOfBusiness: batch.lineOfBusiness,
      month: batch.month,
      year: batch.year,
      batchNumber: batch.batchNumber,
      salesTrainer: trainerRef(batch, BatchTrainerRole.SALES),
      supportTrainer: trainerRef(batch, BatchTrainerRole.SALES_SUPPORT),
      startDate: startYmd,
      targetCompletionDate: milestoneDate(TRAINING_WORKING_DAYS),
      actualCompletionDate: funnelBatch.actualCompletionYmd,
      status: batchTrainingStatus(funnelBatch, todayYmd),
      trainingDay: day,
      totalDays: TRAINING_WORKING_DAYS,
      milestones: {
        joinWindowCloses: milestoneDate(JOIN_WINDOW_DAYS),
        headcountLocks: milestoneDate(HEADCOUNT_LOCK_DAY),
        evaluation: milestoneDate(EVALUATION_DAY),
        exam: milestoneDate(TRAINING_WORKING_DAYS),
      },
      funnel,
    },
    trainees,
  };
}

async function loadBatches(user: AuthUser, filters: TrackerFilters) {
  const where: Prisma.ProgramBatchWhereInput = { AND: [await scopeWhere(user), ...filterWhere(filters)] };
  const query = () =>
    prisma.programBatch.findMany({
      where,
      include: batchInclude,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
  let batches = await query();
  if (await refreshStaleProgress(batches)) {
    batches = await query();
  }
  return batches;
}

async function filterOptions(user: AuthUser) {
  const scope = await scopeWhere(user);
  const programs = await prisma.program.findMany({
    where: { batches: { some: scope } },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
  const trainers = isProgramReviewer(user.role)
    ? await prisma.user.findMany({
        where: { role: Role.TRAINER, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  return { programs, trainers };
}

export const batchTrackerService = {
  async overview(user: AuthUser, filters: TrackerFilters) {
    const [calendar, batches, options] = await Promise.all([
      workCalendarService.load(),
      loadBatches(user, filters),
      filterOptions(user),
    ]);
    const todayYmd = zonedYmd(new Date(), env.timezone);
    const rows = batches
      .map((batch) => buildBatch(batch, calendar, todayYmd).summary)
      .filter((row) => !filters.status || row.status === filters.status);

    return {
      today: todayYmd,
      summary: {
        batches: rows.length,
        ongoing: rows.filter((row) => row.status === "ONGOING").length,
        completed: rows.filter((row) => row.status === "COMPLETED").length,
        upcoming: rows.filter((row) => row.status === "UPCOMING").length,
        funnel: combineFunnels(rows.map((row) => row.funnel)),
      },
      batches: rows,
      filterOptions: options,
    };
  },

  async detail(user: AuthUser, batchId: string) {
    const access = await batchService.requireBatchAccess(user, batchId);
    const [calendar, batches] = await Promise.all([workCalendarService.load(), loadBatches(user, { batchId })]);
    const batch = batches[0];
    if (!batch) {
      throw ApiError.notFound("Batch not found");
    }
    const todayYmd = zonedYmd(new Date(), env.timezone);
    const built = buildBatch(batch, calendar, todayYmd);

    return {
      today: todayYmd,
      canManage: batchService.canManageBatch(user, access),
      batch: { ...built.summary, capacity: batch.capacity },
      trainees: built.trainees.map(({ row, exam, classified }) => ({
        enrollmentId: row.id,
        trainee: row.user,
        status: row.status,
        stage: classified.stage,
        attrition: classified.attrition,
        joinedAt: ymd(row.joinedAt),
        joinDay: classified.joinDay,
        joinedLate: classified.joinedLate,
        progress: Number(row.overallProgress),
        courseOutcome: row.courseOutcome,
        exam: exam
          ? {
              score: exam.score === null ? null : Number(exam.score),
              passed: exam.passed,
              needsReview: exam.needsReview,
              submittedAt: exam.submittedAt?.toISOString() ?? null,
            }
          : null,
        appeared: classified.appeared,
        certified: classified.certified,
        certificate: row.certificate
          ? {
              status: row.certificate.status,
              issuedAt: row.certificate.issuedAt.toISOString(),
              certificateId: row.certificate.certificateId,
            }
          : null,
        handedOverAt: ymd(row.handedOverAt),
        team: row.team,
        exitedAt: ymd(row.exitedAt),
        exitDay: classified.exitDay,
        exitReason: row.exitReason,
        exitedBy: row.exitedBy,
        canRemove:
          !isExitedEnrollment(row.status) && enrollmentActivity(row._count, Boolean(row.certificate)).length === 0,
      })),
    };
  },
};
