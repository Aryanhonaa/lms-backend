import {
  AssessmentAttemptStatus,
  IndividualRequirementStatus,
  IndividualRequirementType,
  InterventionStatus,
  InterventionTrigger,
  Prisma,
  QuizKind,
} from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { individualRequirementRepository } from "../repositories/individual-requirement.repository";
import { interventionRepository } from "../repositories/intervention.repository";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";

const EXAM_KINDS: QuizKind[] = [QuizKind.WEEKLY_EXAM, QuizKind.MILESTONE_EXAM, QuizKind.FINAL_EXAM];

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function triggerReason(trigger: InterventionTrigger): string {
  if (trigger === InterventionTrigger.PROGRESS_BELOW_THRESHOLD) {
    return "Progress is below the program threshold.";
  }
  return "An exam score is below the program threshold.";
}

function effectiveRequirementStatus(
  status: IndividualRequirementStatus,
  deadline: Date | null,
  now: Date,
): IndividualRequirementStatus {
  if (status === IndividualRequirementStatus.COMPLETED) {
    return status;
  }
  if (deadline && now.getTime() > deadline.getTime()) {
    return IndividualRequirementStatus.OVERDUE;
  }
  return status;
}

function person(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email };
}

function toFlagPayload(
  flag: NonNullable<Awaited<ReturnType<typeof interventionRepository.findById>>>,
  latestExamScore: number | null,
) {
  return {
    id: flag.id,
    trigger: flag.trigger,
    status: flag.status,
    progress: toNumber(flag.progressPercent),
    examScore: toNumber(flag.examScore) ?? latestExamScore,
    examTitle: flag.quiz?.title ?? null,
    createdAt: flag.createdAt,
    acknowledgedAt: flag.acknowledgedAt,
    resolvedAt: flag.resolvedAt,
    trainee: person(flag.enrollment.user),
    program: { id: flag.program.id, title: flag.program.title },
    enrollmentId: flag.enrollmentId,
    openRequirements: flag.requirements.filter((row) => row.status !== IndividualRequirementStatus.COMPLETED).length,
  };
}

function toRequirementPayload(
  row: NonNullable<Awaited<ReturnType<typeof individualRequirementRepository.findById>>>,
  now = new Date(),
) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    trainerMessage: row.trainerMessage,
    reason: row.reason || (row.interventionFlag ? triggerReason(row.interventionFlag.trigger) : "Assigned by your trainer."),
    deadline: row.deadline,
    status: effectiveRequirementStatus(row.status, row.deadline, now),
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    trainee: person(row.enrollment.user),
    trainer: person(row.assignedBy),
    program: { id: row.enrollment.program.id, title: row.enrollment.program.title },
    enrollmentId: row.enrollmentId,
    interventionFlagId: row.interventionFlagId,
  };
}

async function latestExamForEnrollment(enrollmentId: string) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: {
      enrollmentId,
      status: { in: [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.TIMED_OUT] },
      quiz: { kind: { in: EXAM_KINDS } },
    },
    include: { quiz: { select: { id: true, title: true, kind: true } } },
    orderBy: { submittedAt: "desc" },
  });
  if (!attempt) {
    return null;
  }
  return {
    quizId: attempt.quizId,
    attemptId: attempt.id,
    title: attempt.quiz.title,
    score: toNumber(attempt.score),
    passed: attempt.passed,
  };
}

async function createFlagSafe(
  input: Parameters<typeof interventionRepository.create>[0],
) {
  try {
    return await interventionRepository.create(input);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

export const interventionService = {
  async evaluateEnrollment(enrollmentId: string) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { program: true },
    });
    if (!enrollment || enrollment.status === "WITHDRAWN") {
      return;
    }

    const progress = toNumber(enrollment.overallProgress) ?? 0;
    const progressThreshold = toNumber(enrollment.program.progressThreshold) ?? 60;
    const examThreshold = toNumber(enrollment.program.examScoreThreshold) ?? 60;

    if (progress < progressThreshold) {
      const existing = await interventionRepository.findOpen(
        enrollment.id,
        InterventionTrigger.PROGRESS_BELOW_THRESHOLD,
      );
      if (!existing) {
        await createFlagSafe({
          enrollmentId: enrollment.id,
          programId: enrollment.programId,
          trigger: InterventionTrigger.PROGRESS_BELOW_THRESHOLD,
          progressPercent: progress,
        });
      }
    } else {
      await interventionRepository.resolveOpen(enrollment.id, InterventionTrigger.PROGRESS_BELOW_THRESHOLD);
    }

    const examAttempts = await prisma.assessmentAttempt.findMany({
      where: {
        enrollmentId: enrollment.id,
        status: { in: [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.TIMED_OUT] },
        quiz: { kind: { in: EXAM_KINDS } },
      },
      include: { quiz: { select: { id: true } } },
      orderBy: { submittedAt: "desc" },
    });

    const latestByQuiz = new Map<string, { score: number; attemptId: string }>();
    for (const attempt of examAttempts) {
      if (latestByQuiz.has(attempt.quizId)) {
        continue;
      }
      const score = toNumber(attempt.score);
      if (score === null) {
        continue;
      }
      latestByQuiz.set(attempt.quizId, { score, attemptId: attempt.id });
    }

    for (const [quizId, latest] of latestByQuiz) {
      if (latest.score < examThreshold) {
        const existing = await interventionRepository.findOpen(
          enrollment.id,
          InterventionTrigger.EXAM_SCORE_BELOW_THRESHOLD,
          quizId,
        );
        if (!existing) {
          await createFlagSafe({
            enrollmentId: enrollment.id,
            programId: enrollment.programId,
            trigger: InterventionTrigger.EXAM_SCORE_BELOW_THRESHOLD,
            progressPercent: progress,
            examScore: latest.score,
            quizId,
            attemptId: latest.attemptId,
          });
        }
      } else {
        await interventionRepository.resolveOpen(
          enrollment.id,
          InterventionTrigger.EXAM_SCORE_BELOW_THRESHOLD,
          quizId,
        );
      }
    }
  },

  async listFlags(user: AuthUser, status?: InterventionStatus) {
    if (user.role === "TRAINEE") {
      throw ApiError.forbidden();
    }

    const programIds =
      isProgramReviewer(user.role)
        ? (await prisma.program.findMany({ select: { id: true } })).map((row) => row.id)
        : await programService.listProgramIdsForTrainer(user.id);

    const flags = await interventionRepository.listForPrograms(programIds, status);
    const payloads = [];
    for (const flag of flags) {
      const latest = await latestExamForEnrollment(flag.enrollmentId);
      payloads.push(toFlagPayload(flag, latest?.score ?? null));
    }
    return { interventions: payloads };
  },

  async updateFlag(user: AuthUser, flagId: string, status: InterventionStatus) {
    const flag = await interventionRepository.findById(flagId);
    if (!flag) {
      throw ApiError.notFound("Intervention not found");
    }
    await programService.requireTrainerOnProgram(user, flag.programId);
    const saved = await interventionRepository.updateStatus(flagId, status);
    const latest = await latestExamForEnrollment(saved.enrollmentId);
    return { intervention: toFlagPayload(saved, latest?.score ?? null) };
  },

  async listTrainerEnrollments(user: AuthUser) {
    if (user.role === "TRAINEE") {
      throw ApiError.forbidden();
    }
    const programIds =
      isProgramReviewer(user.role)
        ? (await prisma.program.findMany({ select: { id: true } })).map((row) => row.id)
        : await programService.listProgramIdsForTrainer(user.id);
    const enrollments = await enrollmentRepository.findByProgramIds(programIds);
    return {
      enrollments: enrollments.map((row) => ({
        id: row.id,
        progress: toNumber(row.overallProgress),
        trainee: person(row.user),
        program: { id: row.program.id, title: row.program.title },
      })),
    };
  },

  async listRequirements(user: AuthUser) {
    if (user.role === "TRAINEE") {
      const enrollments = await enrollmentRepository.findByUser(user.id);
      const rows = await individualRequirementRepository.listForEnrollments(enrollments.map((row) => row.id));
      await this.refreshOverdue(rows);
      const refreshed = await individualRequirementRepository.listForEnrollments(enrollments.map((row) => row.id));
      return { requirements: refreshed.map((row) => toRequirementPayload(row)) };
    }

    const programIds =
      isProgramReviewer(user.role)
        ? (await prisma.program.findMany({ select: { id: true } })).map((row) => row.id)
        : await programService.listProgramIdsForTrainer(user.id);
    const enrollments = await enrollmentRepository.findByProgramIds(programIds);
    const rows = await individualRequirementRepository.listForEnrollments(enrollments.map((row) => row.id));
    await this.refreshOverdue(rows);
    const refreshed = await individualRequirementRepository.listForEnrollments(enrollments.map((row) => row.id));
    return { requirements: refreshed.map((row) => toRequirementPayload(row)) };
  },

  async getRequirement(user: AuthUser, id: string) {
    const row = await this.requireRequirementAccess(user, id);
    await this.refreshOverdue([row]);
    const refreshed = await individualRequirementRepository.findById(id);
    return { requirement: toRequirementPayload(refreshed ?? row) };
  },

  async assign(
    user: AuthUser,
    input: {
      enrollmentId: string;
      interventionFlagId?: string | null;
      type: IndividualRequirementType;
      title: string;
      description?: string;
      trainerMessage?: string;
      reason?: string;
      deadline?: string | Date | null;
    },
  ) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }

    const enrollment = await enrollmentRepository.findWithUser(input.enrollmentId);
    if (!enrollment) {
      throw ApiError.notFound("Enrollment not found");
    }
    await programService.requireTrainerOnProgram(user, enrollment.programId);

    let flag = null as Awaited<ReturnType<typeof interventionRepository.findById>>;
    if (input.interventionFlagId) {
      flag = await interventionRepository.findById(input.interventionFlagId);
      if (!flag || flag.enrollmentId !== enrollment.id) {
        throw ApiError.badRequest("Intervention does not belong to this trainee");
      }
    }

    const deadline = input.deadline ? new Date(input.deadline) : null;
    const created = await individualRequirementRepository.create({
      enrollmentId: enrollment.id,
      assignedByUserId: user.id,
      interventionFlagId: flag?.id ?? null,
      type: input.type,
      title: input.title,
      description: input.description ?? "",
      trainerMessage: input.trainerMessage ?? "",
      reason: input.reason ?? (flag ? triggerReason(flag.trigger) : "Assigned by your trainer."),
      deadline,
    });

    return { requirement: toRequirementPayload(created) };
  },

  async startRequirement(user: AuthUser, id: string) {
    const row = await this.requireRequirementAccess(user, id);
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    if (row.status === IndividualRequirementStatus.COMPLETED) {
      throw ApiError.badRequest("This requirement is already complete");
    }
    const saved = await individualRequirementRepository.update(id, {
      status: IndividualRequirementStatus.IN_PROGRESS,
    });
    return { requirement: toRequirementPayload(saved) };
  },

  async completeRequirement(user: AuthUser, id: string) {
    const row = await this.requireRequirementAccess(user, id);
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    const saved = await individualRequirementRepository.update(id, {
      status: IndividualRequirementStatus.COMPLETED,
      completedAt: new Date(),
    });
    const { certificateService } = await import("./certificate.service");
    await certificateService.issueIfEligible(saved.enrollmentId);
    return { requirement: toRequirementPayload(saved) };
  },

  async requireRequirementAccess(user: AuthUser, id: string) {
    const row = await individualRequirementRepository.findById(id);
    if (!row) {
      throw ApiError.notFound("Requirement not found");
    }

    if (isProgramReviewer(user.role)) {
      return row;
    }

    if (user.role === "TRAINEE") {
      if (row.enrollment.user.id !== user.id) {
        throw ApiError.notFound("Requirement not found");
      }
      return row;
    }

    if (user.role === "TRAINER") {
      await programService.requireTrainerOnProgram(user, row.enrollment.program.id);
      return row;
    }

    throw ApiError.forbidden();
  },

  async refreshOverdue(rows: Array<{ id: string; status: IndividualRequirementStatus; deadline: Date | null }>) {
    const now = new Date();
    const overdueIds = rows
      .filter(
        (row) =>
          row.status !== IndividualRequirementStatus.COMPLETED &&
          row.deadline &&
          now.getTime() > row.deadline.getTime() &&
          row.status !== IndividualRequirementStatus.OVERDUE,
      )
      .map((row) => row.id);
    if (overdueIds.length > 0) {
      await individualRequirementRepository.markOverdue(overdueIds);
    }
  },
};
