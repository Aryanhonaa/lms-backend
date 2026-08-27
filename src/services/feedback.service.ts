import {
  EnrollmentStatus,
  FeedbackModerationStatus,
  FeedbackTargetKind,
  Role,
} from "../generated/prisma";
import { prisma } from "../config/prisma";
import { feedbackRepository } from "../repositories/engagement.repository";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { certificateService } from "./certificate.service";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";

type SubmitInput = {
  targetKind: FeedbackTargetKind;
  targetId: string;
  programId?: string;
  enrollmentId?: string;
  batchId?: string;
  rating: number;
  comment?: string;
};

type UserEnrollment = Awaited<ReturnType<typeof enrollmentRepository.findByUser>>[number];

function pickEnrollment(
  enrollments: UserEnrollment[],
  input: { enrollmentId?: string; batchId?: string; programId: string },
): UserEnrollment {
  const matching = enrollments.filter((row) => row.programId === input.programId && row.status !== EnrollmentStatus.WITHDRAWN);
  if (matching.length === 0) {
    throw ApiError.notFound("Program not found");
  }
  if (input.enrollmentId) {
    const enrollment = matching.find((row) => row.id === input.enrollmentId);
    if (!enrollment) {
      throw ApiError.notFound("Enrollment not found");
    }
    return enrollment;
  }
  if (input.batchId) {
    const enrollment = matching.find((row) => row.batchId === input.batchId);
    if (!enrollment) {
      throw ApiError.notFound("Enrollment not found");
    }
    return enrollment;
  }
  if (matching.length === 1) {
    return matching[0];
  }
  return matching.find((row) => row.status === EnrollmentStatus.COMPLETED) ?? matching[0];
}

function toPayload(
  row: Awaited<ReturnType<typeof feedbackRepository.create>>,
  includeAuthor: boolean,
) {
  return {
    id: row.id,
    targetKind: row.targetKind,
    targetId: row.targetId,
    rating: row.rating,
    comment: row.comment,
    status: row.status,
    createdAt: row.createdAt,
    program: row.program,
    author: includeAuthor ? row.author : { id: row.author.id, name: row.author.name },
  };
}

async function resolveTarget(userId: string, input: SubmitInput) {
  const enrollments = await enrollmentRepository.findByUser(userId);
  if (enrollments.length === 0) {
    throw ApiError.badRequest("You are not enrolled in a program");
  }

  if (input.targetKind === FeedbackTargetKind.COURSE) {
    const enrollment = pickEnrollment(enrollments, {
      enrollmentId: input.enrollmentId,
      batchId: input.batchId,
      programId: input.targetId,
    });
    return { programId: enrollment.programId, enrollmentId: enrollment.id };
  }

  if (input.targetKind === FeedbackTargetKind.TRAINER) {
    const trainer = await prisma.programTrainer.findFirst({
      where: {
        userId: input.targetId,
        programId: { in: enrollments.map((row) => row.programId) },
      },
    });
    if (!trainer) {
      throw ApiError.notFound("Trainer not found");
    }
    const enrollment = pickEnrollment(enrollments, {
      enrollmentId: input.enrollmentId,
      batchId: input.batchId,
      programId: trainer.programId,
    });
    return { programId: trainer.programId, enrollmentId: enrollment.id };
  }

  if (input.targetKind === FeedbackTargetKind.SESSION) {
    const session = await prisma.trainingSession.findFirst({
      where: {
        id: input.targetId,
        week: { programId: { in: enrollments.map((row) => row.programId) } },
      },
      include: { week: true },
    });
    if (!session) {
      throw ApiError.notFound("Session not found");
    }
    const enrollment = pickEnrollment(enrollments, {
      enrollmentId: input.enrollmentId,
      batchId: input.batchId,
      programId: session.week.programId,
    });
    return { programId: session.week.programId, enrollmentId: enrollment.id };
  }

  const programIds = enrollments.map((row) => row.programId);
  const [lesson, video, resource, reel] = await Promise.all([
    prisma.lesson.findFirst({ where: { id: input.targetId, day: { week: { programId: { in: programIds } } } }, include: { day: { include: { week: true } } } }),
    prisma.video.findFirst({ where: { id: input.targetId, day: { week: { programId: { in: programIds } } } }, include: { day: { include: { week: true } } } }),
    prisma.resource.findFirst({ where: { id: input.targetId, day: { week: { programId: { in: programIds } } } }, include: { day: { include: { week: true } } } }),
    prisma.reel.findFirst({ where: { id: input.targetId, day: { week: { programId: { in: programIds } } } }, include: { day: { include: { week: true } } } }),
  ]);
  const material = lesson ?? video ?? resource ?? reel;
  if (!material) {
    throw ApiError.notFound("Material not found");
  }
  const programId = material.day.week.programId;
  const enrollment = pickEnrollment(enrollments, {
    enrollmentId: input.enrollmentId,
    batchId: input.batchId,
    programId,
  });
  return { programId, enrollmentId: enrollment.id };
}

export const feedbackService = {
  async options(user: AuthUser) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    const enrollments = await enrollmentRepository.findByUser(user.id);
    const programIds = enrollments.map((row) => row.programId);
    if (programIds.length === 0) {
      return { courses: [], trainers: [], sessions: [], materials: [] };
    }

    const programs = await prisma.program.findMany({
      where: { id: { in: programIds } },
      select: {
        id: true,
        title: true,
        trainers: { include: { user: { select: { id: true, name: true } } } },
        weeks: {
          select: {
            trainingSessions: { select: { id: true, title: true }, orderBy: { sortOrder: "asc" } },
            days: {
              select: {
                lessons: { select: { id: true, title: true } },
                videos: { select: { id: true, title: true } },
                resources: { select: { id: true, title: true } },
                reels: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    });

    return {
      courses: programs.map((program) => ({ id: program.id, title: program.title })),
      trainers: programs.flatMap((program) =>
        program.trainers.map((trainer) => ({
          id: trainer.user.id,
          name: trainer.user.name,
          programId: program.id,
          programTitle: program.title,
        })),
      ),
      sessions: programs.flatMap((program) =>
        program.weeks.flatMap((week) =>
          week.trainingSessions.map((session) => ({
            id: session.id,
            title: session.title,
            programId: program.id,
            programTitle: program.title,
          })),
        ),
      ),
      materials: programs.flatMap((program) =>
        program.weeks.flatMap((week) =>
          week.days.flatMap((day) => [
            ...day.lessons.map((item) => ({ id: item.id, title: item.title, kind: "LESSON" as const, programId: program.id })),
            ...day.videos.map((item) => ({ id: item.id, title: item.title, kind: "VIDEO" as const, programId: program.id })),
            ...day.resources.map((item) => ({ id: item.id, title: item.title, kind: "RESOURCE" as const, programId: program.id })),
            ...day.reels.map((item) => ({ id: item.id, title: item.title, kind: "REEL" as const, programId: program.id })),
          ]),
        ),
      ),
    };
  },

  async submit(user: AuthUser, input: SubmitInput) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    const target = await resolveTarget(user.id, input);
    if (input.targetKind === FeedbackTargetKind.COURSE) {
      const existing = await feedbackRepository.findCourseReview(target.enrollmentId);
      if (existing) {
        await certificateService.issueIfEligible(target.enrollmentId);
        return { feedback: toPayload(existing, false) };
      }
    }
    const created = await feedbackRepository.create({
      authorUserId: user.id,
      targetKind: input.targetKind,
      targetId: input.targetId,
      programId: target.programId,
      enrollmentId: target.enrollmentId,
      rating: input.rating,
      comment: input.comment?.trim() ?? "",
    });
    if (input.targetKind === FeedbackTargetKind.COURSE) {
      await certificateService.issueIfEligible(target.enrollmentId);
    }
    return { feedback: toPayload(created, false) };
  },

  async listMine(user: AuthUser) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }
    const rows = await feedbackRepository.listForAuthor(user.id);
    return { feedback: rows.map((row) => toPayload(row, false)) };
  },

  async getMine(user: AuthUser, id: string) {
    const row = await feedbackRepository.findById(id);
    if (!row) {
      throw ApiError.notFound("Feedback not found");
    }
    if (user.role === "TRAINEE") {
      if (row.authorUserId !== user.id) {
        throw ApiError.notFound("Feedback not found");
      }
      return { feedback: toPayload(row, false) };
    }
    if (user.role === "TRAINER") {
      if (!row.programId) {
        throw ApiError.forbidden();
      }
      await programService.requireTrainerOnProgram(user, row.programId);
      return { feedback: toPayload(row, true) };
    }
    if (user.role !== Role.SUPER_ADMIN) {
      throw ApiError.forbidden();
    }
    return { feedback: toPayload(row, true) };
  },

  async listForTrainer(user: AuthUser, programId?: string, status?: FeedbackModerationStatus) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }
    const programs = await programService.listForTrainer(user.id);
    const ids = programId ? [programId] : programs.map((row) => row.id);
    if (programId) {
      await programService.requireTrainerOnProgram(user, programId);
    }
    const rows = await feedbackRepository.listForPrograms(ids, status);
    return { feedback: rows.map((row) => toPayload(row, true)) };
  },

  async listForAdmin(user: AuthUser, status?: FeedbackModerationStatus) {
    if (user.role !== "SUPER_ADMIN") {
      throw ApiError.forbidden();
    }
    const rows = await feedbackRepository.listAll(status);
    return { feedback: rows.map((row) => toPayload(row, true)) };
  },

  async moderate(user: AuthUser, id: string, status: FeedbackModerationStatus) {
    if (user.role !== "SUPER_ADMIN") {
      throw ApiError.forbidden();
    }
    const existing = await feedbackRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound("Feedback not found");
    }
    const saved = await feedbackRepository.moderate(id, status, user.id);
    return { feedback: toPayload(saved, true) };
  },
};
