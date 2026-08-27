import { prisma } from "../config/prisma";

const sessionInclude = {
  week: {
    include: {
      program: { select: { id: true, title: true } },
    },
  },
} as const;

const attendanceInclude = {
  trainingSession: { include: sessionInclude },
  enrollment: {
    include: {
      user: { select: { id: true, name: true, email: true } },
      program: { select: { id: true, title: true } },
    },
  },
  markedBy: { select: { id: true, name: true, email: true } },
} as const;

export const attendanceRepository = {
  findSession(id: string) {
    return prisma.trainingSession.findUnique({
      where: { id },
      include: sessionInclude,
    });
  },

  listSessionsForPrograms(programIds: string[]) {
    if (programIds.length === 0) {
      return Promise.resolve([]);
    }

    return prisma.trainingSession.findMany({
      where: { week: { programId: { in: programIds } } },
      include: sessionInclude,
      orderBy: { startsAt: "asc" },
    });
  },

  listSessionsForProgram(programId: string) {
    return this.listSessionsForPrograms([programId]);
  },

  findAttendance(id: string) {
    return prisma.attendance.findUnique({
      where: { id },
      include: attendanceInclude,
    });
  },

  findAttendanceForSession(trainingSessionId: string, enrollmentId: string) {
    return prisma.attendance.findUnique({
      where: {
        trainingSessionId_enrollmentId: { trainingSessionId, enrollmentId },
      },
      include: attendanceInclude,
    });
  },

  listForSession(trainingSessionId: string) {
    return prisma.attendance.findMany({
      where: { trainingSessionId },
      include: attendanceInclude,
    });
  },

  listForEnrollments(enrollmentIds: string[]) {
    if (enrollmentIds.length === 0) {
      return Promise.resolve([]);
    }

    return prisma.attendance.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      include: attendanceInclude,
      orderBy: { trainingSession: { startsAt: "asc" } },
    });
  },

  listStatusesForEnrollment(enrollmentId: string) {
    return prisma.attendance.findMany({
      where: { enrollmentId },
      select: { status: true },
    });
  },

  upsert(input: {
    trainingSessionId: string;
    enrollmentId: string;
    status: Parameters<typeof prisma.attendance.upsert>[0]["create"]["status"];
    markedByUserId: string;
  }) {
    return prisma.attendance.upsert({
      where: {
        trainingSessionId_enrollmentId: {
          trainingSessionId: input.trainingSessionId,
          enrollmentId: input.enrollmentId,
        },
      },
      create: input,
      update: {
        status: input.status,
        markedByUserId: input.markedByUserId,
      },
      include: attendanceInclude,
    });
  },

  updateStatus(id: string, status: Parameters<typeof prisma.attendance.update>[0]["data"]["status"], markedByUserId: string) {
    return prisma.attendance.update({
      where: { id },
      data: { status, markedByUserId },
      include: attendanceInclude,
    });
  },
};
