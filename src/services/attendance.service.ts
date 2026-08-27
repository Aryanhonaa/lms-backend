import { AttendanceStatus, EnrollmentStatus } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { attendanceRepository } from "../repositories/attendance.repository";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programService } from "./program.service";
import { progressService } from "./progress.service";
import type { AuthUser } from "../types";
import { attendancePercentage } from "../utils/attendance-math";
import { ApiError } from "../utils/api-error";

function person(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toClock(date: Date): string {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toSessionPayload(
  session: NonNullable<Awaited<ReturnType<typeof attendanceRepository.findSession>>>,
) {
  const endsAt = session.endsAt ?? new Date(session.startsAt.getTime() + 60 * 60 * 1000);
  return {
    id: session.id,
    title: session.title,
    description: session.description,
    date: toDateOnly(session.startsAt),
    startTime: toClock(session.startsAt),
    endTime: toClock(endsAt),
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    meetingLink: session.meetingUrl,
    meetingUrl: session.meetingUrl,
    week: { id: session.week.id, title: session.week.title, sortOrder: session.week.sortOrder },
    program: session.week.program,
  };
}

async function percentForEnrollment(enrollmentId: string): Promise<number | null> {
  const rows = await attendanceRepository.listStatusesForEnrollment(enrollmentId);
  return attendancePercentage(rows.map((row) => row.status));
}

export const attendanceService = {
  async listProgram(user: AuthUser, programId: string, sessionId?: string) {
    await programService.requireTrainerOnProgram(user, programId);
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { id: true, title: true, weeks: { select: { id: true, title: true, sortOrder: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!program) {
      throw ApiError.notFound("Program not found");
    }
    const sessions = await attendanceRepository.listSessionsForProgram(programId);
    const enrollments = (await enrollmentRepository.findByProgramIds([programId])).filter(
      (row) => row.status !== EnrollmentStatus.WITHDRAWN,
    );

    const percents = new Map<string, number | null>();
    for (const enrollment of enrollments) {
      percents.set(enrollment.id, await percentForEnrollment(enrollment.id));
    }

    const selectedId = sessionId ?? sessions[0]?.id ?? null;
    const selected = selectedId ? sessions.find((row) => row.id === selectedId) ?? null : null;
    const marks = selected ? await attendanceRepository.listForSession(selected.id) : [];
    const markByEnrollment = new Map(marks.map((row) => [row.enrollmentId, row]));

    return {
      program: { id: program.id, title: program.title },
      weeks: program.weeks.map((week) => ({ id: week.id, title: week.title })),
      sessions: sessions.map((row) => toSessionPayload(row)),
      selectedSessionId: selected?.id ?? null,
      roster: selected
        ? enrollments.map((enrollment) => {
            const mark = markByEnrollment.get(enrollment.id);
            return {
              enrollmentId: enrollment.id,
              trainee: person(enrollment.user),
              status: mark?.status ?? null,
              attendanceId: mark?.id ?? null,
              attendancePercent: percents.get(enrollment.id) ?? null,
            };
          })
        : [],
    };
  },

  async mark(
    user: AuthUser,
    sessionId: string,
    records: Array<{ enrollmentId: string; status: AttendanceStatus }>,
  ) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }

    const session = await attendanceRepository.findSession(sessionId);
    if (!session) {
      throw ApiError.notFound("Training session not found");
    }
    await programService.requireTrainerOnProgram(user, session.week.program.id);

    const saved = [];
    for (const record of records) {
      const enrollment = await enrollmentRepository.findWithUser(record.enrollmentId);
      if (!enrollment || enrollment.program.id !== session.week.program.id) {
        throw ApiError.badRequest("Enrollment does not belong to this program");
      }
      saved.push(
        await attendanceRepository.upsert({
          trainingSessionId: session.id,
          enrollmentId: enrollment.id,
          status: record.status,
          markedByUserId: user.id,
        }),
      );
      await progressService.recomputeEnrollment(enrollment.id);
    }

    return this.listProgram(user, session.week.program.id, session.id);
  },

  async update(user: AuthUser, attendanceId: string, status: AttendanceStatus) {
    if (user.role !== "TRAINER") {
      throw ApiError.forbidden();
    }

    const row = await attendanceRepository.findAttendance(attendanceId);
    if (!row) {
      throw ApiError.notFound("Attendance record not found");
    }
    await programService.requireTrainerOnProgram(user, row.enrollment.program.id);
    const saved = await attendanceRepository.updateStatus(attendanceId, status, user.id);
    await progressService.recomputeEnrollment(saved.enrollmentId);
    return {
      attendance: {
        id: saved.id,
        status: saved.status,
        enrollmentId: saved.enrollmentId,
        sessionId: saved.trainingSessionId,
        trainee: person(saved.enrollment.user),
      },
    };
  },

  async listForTrainee(user: AuthUser) {
    if (user.role !== "TRAINEE") {
      throw ApiError.forbidden();
    }

    const enrollments = await enrollmentRepository.findByUser(user.id);
    const rows = await attendanceRepository.listForEnrollments(enrollments.map((row) => row.id));
    const sessions = await attendanceRepository.listSessionsForPrograms(enrollments.map((row) => row.programId));
    const now = new Date();

    const programs = [];
    for (const enrollment of enrollments) {
      const mine = rows.filter((row) => row.enrollmentId === enrollment.id);
      const programSessions = sessions.filter((row) => row.week.program.id === enrollment.programId);
      const history = programSessions
        .filter((session) => session.startsAt.getTime() <= now.getTime())
        .map((session) => {
          const mark = mine.find((row) => row.trainingSessionId === session.id);
          return {
            session: toSessionPayload(session),
            status: mark?.status ?? null,
          };
        });
      const upcoming = programSessions
        .filter((session) => session.startsAt.getTime() > now.getTime())
        .map((session) => toSessionPayload(session));

      programs.push({
        program: { id: enrollment.program.id, title: enrollment.program.title },
        enrollmentId: enrollment.id,
        attendancePercent: attendancePercentage(mine.map((row) => row.status)),
        history,
        upcoming,
      });
    }

    return { programs };
  },

  async getRecord(user: AuthUser, id: string) {
    const row = await attendanceRepository.findAttendance(id);
    if (!row) {
      throw ApiError.notFound("Attendance record not found");
    }

    if (user.role === "TRAINEE") {
      if (row.enrollment.user.id !== user.id) {
        throw ApiError.notFound("Attendance record not found");
      }
    } else if (user.role === "TRAINER") {
      await programService.requireTrainerOnProgram(user, row.enrollment.program.id);
    } else if (user.role !== "SUPER_ADMIN") {
      throw ApiError.forbidden();
    }

    return {
      attendance: {
        id: row.id,
        status: row.status,
        trainee: person(row.enrollment.user),
        session: toSessionPayload(row.trainingSession),
        program: row.enrollment.program,
      },
    };
  },
};
