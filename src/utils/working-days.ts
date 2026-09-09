export const TRAINING_WORKING_DAYS = 25;
export const LATE_JOIN_WORKING_DAYS = 3;
export const HR_ATTRITION_WORKING_DAYS = 3;
export const DAY7_WORKING_DAYS = 7;
export const TNI_SCORE_THRESHOLD = 75;

export function dateOnly(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function isWeekend(value: Date): boolean {
  const day = dateOnly(value).getUTCDay();
  return day === 0 || day === 6;
}

export function addCalendarDays(value: Date | string, days: number): Date {
  const next = dateOnly(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addWorkingDays(start: Date | string, workingDays: number): Date {
  const cursor = dateOnly(start);
  let remaining = workingDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor)) {
      remaining -= 1;
    }
  }
  return cursor;
}

export function countWorkingDaysInclusive(start: Date | string, end: Date | string): number {
  const cursor = dateOnly(start);
  const last = dateOnly(end);
  if (last.getTime() < cursor.getTime()) {
    return 0;
  }
  let count = 0;
  while (cursor.getTime() <= last.getTime()) {
    if (!isWeekend(cursor)) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function currentTrainingDay(start: Date | string, now = new Date()): number {
  return Math.min(TRAINING_WORKING_DAYS, countWorkingDaysInclusive(start, now));
}

export function monthCode(month: number): string {
  return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][month - 1] ?? "JAN";
}

export function buildBatchCode(month: number, year: number, batchNumber: number): string {
  return `NHT-${monthCode(month)}-${year}-${String(batchNumber).padStart(2, "0")}`;
}

export function safePercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}
