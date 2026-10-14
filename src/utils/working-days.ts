/** Weekday numbers follow JS: 0 = Sunday … 6 = Saturday. Dates are civil `YYYY-MM-DD` strings. */
export type WorkCalendar = {
  weeklyOffDays: readonly number[];
  holidays: ReadonlySet<string>;
};

export const DEFAULT_WEEKLY_OFF_DAYS = [6];
export const TRAINING_WORKING_DAYS = 25;

function toUtcNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

export function shiftYmd(ymd: string, days: number): string {
  const date = toUtcNoon(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayOf(ymd: string): number {
  return toUtcNoon(ymd).getUTCDay();
}

export function isWorkingDay(ymd: string, calendar: WorkCalendar): boolean {
  return !calendar.weeklyOffDays.includes(weekdayOf(ymd)) && !calendar.holidays.has(ymd);
}

/** The date of the `count`-th working day, counting `startYmd` as day 1 when it is a working day. */
export function addWorkingDays(startYmd: string, count: number, calendar: WorkCalendar): string {
  if (calendar.weeklyOffDays.length >= 7) {
    return startYmd;
  }
  let cursor = startYmd;
  let seen = 0;
  for (;;) {
    if (isWorkingDay(cursor, calendar)) {
      seen += 1;
      if (seen >= count) {
        return cursor;
      }
    }
    cursor = shiftYmd(cursor, 1);
  }
}

/** Working days in `[startYmd, ymd]`; 0 when `ymd` is before the start. */
export function workingDayNumber(startYmd: string, ymd: string, calendar: WorkCalendar): number {
  if (ymd < startYmd) {
    return 0;
  }
  let cursor = startYmd;
  let count = 0;
  while (cursor <= ymd) {
    if (isWorkingDay(cursor, calendar)) {
      count += 1;
    }
    cursor = shiftYmd(cursor, 1);
  }
  return count;
}

/** Non-working days (weekly offs and holidays) between two dates, inclusive. */
export function skippedDays(startYmd: string, endYmd: string, calendar: WorkCalendar) {
  let weeklyOff = 0;
  const holidays: string[] = [];
  let cursor = startYmd;
  while (cursor <= endYmd) {
    if (calendar.weeklyOffDays.includes(weekdayOf(cursor))) {
      weeklyOff += 1;
    } else if (calendar.holidays.has(cursor)) {
      holidays.push(cursor);
    }
    cursor = shiftYmd(cursor, 1);
  }
  return { weeklyOff, holidays };
}
