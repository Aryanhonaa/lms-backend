import { EnrollmentStatus, Role } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { userRepository } from "../repositories/user.repository";
import { progressService } from "./progress.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isProgramReviewer } from "../utils/roles";

function requireReviewer(user: AuthUser) {
  if (!isProgramReviewer(user.role)) {
    throw ApiError.forbidden();
  }
}

export const adminPeopleService = {
  async listTrainers(user: AuthUser, query: string) {
    requireReviewer(user);
    const needle = query.trim().toLowerCase();
    const trainers = await userRepository.listPublicByRoles([Role.TRAINER]);
    const filtered = needle
      ? trainers.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle))
      : trainers;
    return { trainers: filtered };
  },

  async listTrainees(user: AuthUser, query: string) {
    requireReviewer(user);
    const needle = query.trim().toLowerCase();
    const trainees = await userRepository.listPublicByRoles([Role.TRAINEE]);
    const filtered = needle
      ? trainees.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle))
      : trainees;

    const counts = await prisma.enrollment.groupBy({
      by: ["userId"],
      where: {
        userId: { in: filtered.map((row) => row.id) },
        status: { not: EnrollmentStatus.WITHDRAWN },
      },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((row) => [row.userId, row._count._all]));

    return {
      trainees: filtered.map((row) => ({
        ...row,
        enrollmentCount: countMap.get(row.id) ?? 0,
      })),
    };
  },

  async getTrainee(viewer: AuthUser, traineeId: string) {
    requireReviewer(viewer);
    const trainee = await userRepository.findPublicById(traineeId);
    if (!trainee || trainee.role !== Role.TRAINEE) {
      throw ApiError.notFound("Trainee not found");
    }

    const enrollments = await enrollmentRepository.findByUserForReview(traineeId);
    const programs = [];
    for (const enrollment of enrollments) {
      const progress = await progressService.getProgressViewForEnrollment(viewer, enrollment.id);
      programs.push({
        enrollmentId: enrollment.id,
        status: enrollment.status,
        enrolledAt: enrollment.createdAt.toISOString(),
        enrolledBy: enrollment.enrolledBy,
        progress,
      });
    }

    return { trainee, programs };
  },
};
