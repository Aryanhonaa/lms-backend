import { AttendanceStatus } from "../generated/prisma";

/** Relation counts that mean a trainee has started using an enrollment. */
export const enrollmentActivityCount = {
  select: {
    completions: true,
    assessmentAttempts: true,
    assignmentSubmissions: true,
    feedback: true,
    attendances: { where: { status: { not: AttendanceStatus.ABSENT } } },
  },
} as const;

export type EnrollmentActivityCounts = {
  completions: number;
  assessmentAttempts: number;
  assignmentSubmissions: number;
  feedback: number;
  attendances: number;
};

export function enrollmentActivity(counts: EnrollmentActivityCounts, hasCertificate: boolean): string[] {
  const reasons: string[] = [];
  if (counts.completions > 0) {
    reasons.push("completed course content");
  }
  if (counts.assessmentAttempts > 0) {
    reasons.push("attempted a quiz or exam");
  }
  if (counts.assignmentSubmissions > 0) {
    reasons.push("submitted an assignment");
  }
  if (counts.attendances > 0) {
    reasons.push("has attendance recorded");
  }
  if (counts.feedback > 0) {
    reasons.push("left feedback");
  }
  if (hasCertificate) {
    reasons.push("has a certificate");
  }
  return reasons;
}
