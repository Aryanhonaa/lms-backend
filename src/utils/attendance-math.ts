import { AttendanceStatus } from "../generated/prisma";

export function attendancePercentage(statuses: AttendanceStatus[]): number | null {
  const countable = statuses.filter((status) => status !== AttendanceStatus.EXCUSED);
  if (countable.length === 0) {
    return null;
  }

  const attended = countable.filter(
    (status) => status === AttendanceStatus.PRESENT || status === AttendanceStatus.LATE,
  ).length;
  return Math.round((attended / countable.length) * 10000) / 100;
}
