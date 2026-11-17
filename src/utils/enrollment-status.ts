import { EnrollmentStatus } from "../generated/prisma";

export const EXITED_ENROLLMENT_STATUSES: EnrollmentStatus[] = [
  EnrollmentStatus.WITHDRAWN,
  EnrollmentStatus.TERMINATED,
  EnrollmentStatus.REMOVED,
];

export const ACTIVE_STATUS_FILTER = { notIn: EXITED_ENROLLMENT_STATUSES };

export function isExitedEnrollment(status: EnrollmentStatus | string): boolean {
  return (EXITED_ENROLLMENT_STATUSES as string[]).includes(status);
}
