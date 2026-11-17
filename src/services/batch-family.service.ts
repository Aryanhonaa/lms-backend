import { CourseOutcome } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programBatchRepository } from "../repositories/program-batch.repository";
import { orderedBatchCourses } from "../utils/course-sequence";
import { isExitedEnrollment } from "../utils/enrollment-status";

export function familyCourseOutcome(
  primary: { courseOutcome: string },
  linked: Array<{ courseOutcome: string } | undefined | null>,
): "PASSED" | "FAILED" | "PENDING" {
  const members = [primary, ...linked];
  if (members.some((row) => !row)) {
    if (members.some((row) => row?.courseOutcome === "FAILED")) {
      return "FAILED";
    }
    return "PENDING";
  }
  const rows = members as Array<{ courseOutcome: string }>;
  if (rows.every((row) => row.courseOutcome === "PASSED")) {
    return "PASSED";
  }
  if (rows.some((row) => row.courseOutcome === "FAILED")) {
    return "FAILED";
  }
  return "PENDING";
}

export async function loadFamilyRoot(batchId: string) {
  const batch = await programBatchRepository.findById(batchId);
  if (!batch) {
    return null;
  }
  if (!batch.linkedFromBatchId) {
    return batch;
  }
  return programBatchRepository.findById(batch.linkedFromBatchId);
}

export async function backfillFamilyEnrollments(userId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId, status: { not: "REMOVED" } },
    select: {
      id: true,
      batchId: true,
      joinedAt: true,
      enrolledByUserId: true,
      status: true,
      batch: { select: { id: true, linkedFromBatchId: true } },
    },
  });
  const rootIds = [...new Set(enrollments.map((row) => row.batch.linkedFromBatchId ?? row.batch.id))];
  for (const rootId of rootIds) {
    const root = await programBatchRepository.findById(rootId);
    if (!root) {
      continue;
    }
    const memberIds = [root.id, ...(root.linkedBatches ?? []).map((item) => item.id)];
    if (memberIds.length < 2) {
      continue;
    }
    const source =
      enrollments.find((row) => row.batchId === root.id && !isExitedEnrollment(row.status)) ??
      enrollments.find((row) => memberIds.includes(row.batchId) && !isExitedEnrollment(row.status));
    if (!source) {
      continue;
    }
    const members = [
      { id: root.id, programId: root.programId },
      ...(root.linkedBatches ?? []).map((item) => ({ id: item.id, programId: item.programId })),
    ];
    for (const member of members) {
      const existing = await enrollmentRepository.findEnrollment(member.id, userId);
      if (existing && !isExitedEnrollment(existing.status)) {
        continue;
      }
      if (existing) {
        continue;
      }
      try {
        await enrollmentRepository.create({
          programId: member.programId,
          userId,
          enrolledByUserId: source.enrolledByUserId,
          batchId: member.id,
          joinedAt: source.joinedAt,
        });
      } catch {
        // Unique race: already created.
      }
    }
  }
}

export async function sequenceLockReason(userId: string, batchId: string | null | undefined, programId: string) {
  if (!batchId) {
    return null;
  }
  const root = await loadFamilyRoot(batchId);
  if (!root) {
    return null;
  }
  const courses = orderedBatchCourses({
    id: root.id,
    programId: root.programId,
    sortOrder: root.sortOrder,
    createdAt: root.createdAt,
    program: root.program,
    linkedBatches: root.linkedBatches,
  });
  const index = courses.findIndex((course) => course.id === programId);
  if (index <= 0) {
    return null;
  }
  const previous = courses[index - 1];
  const previousEnrollment = await prisma.enrollment.findFirst({
    where: { userId, batchId: previous.batchId, status: { not: "REMOVED" } },
    select: { courseOutcome: true, status: true },
  });
  if (previousEnrollment && !isExitedEnrollment(previousEnrollment.status) && previousEnrollment.courseOutcome === CourseOutcome.PASSED) {
    return null;
  }
  return `Complete ${previous.title} before accessing this course.`;
}

export async function familyFullyPassed(userId: string, batchId: string) {
  const root = await loadFamilyRoot(batchId);
  if (!root) {
    return false;
  }
  const memberIds = [root.id, ...(root.linkedBatches ?? []).map((item) => item.id)];
  const enrollments = await prisma.enrollment.findMany({
    where: { userId, batchId: { in: memberIds }, status: { not: "REMOVED" } },
    select: { batchId: true, courseOutcome: true, status: true },
  });
  const active = enrollments.filter((row) => !isExitedEnrollment(row.status));
  if (active.length < memberIds.length) {
    return false;
  }
  return memberIds.every((id) => active.find((row) => row.batchId === id)?.courseOutcome === CourseOutcome.PASSED);
}
