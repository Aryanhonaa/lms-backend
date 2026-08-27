const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: (typeof WEEKDAY_SHORT)[number];
};

function partNumber(parts: Intl.DateTimeFormatPart[], type: string): number {
  return Number(parts.find((part) => part.type === type)?.value ?? "0");
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const weekday = (parts.find((part) => part.type === "weekday")?.value ?? "Mon") as ZonedParts["weekday"];

  return {
    year: partNumber(parts, "year"),
    month: partNumber(parts, "month"),
    day: partNumber(parts, "day"),
    hour: partNumber(parts, "hour"),
    minute: partNumber(parts, "minute"),
    second: partNumber(parts, "second"),
    weekday,
  };
}

export function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function zonedYmd(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  return formatYmd(parts.year, parts.month, parts.day);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const zoned = getZonedParts(instant, timeZone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return asUtc - instant.getTime();
}

export function wallClockInZoneToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const intended = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = intended - zoneOffsetMs(new Date(intended), timeZone);
  utc = intended - zoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

export function startOfZonedDay(year: number, month: number, day: number, timeZone: string): Date {
  return wallClockInZoneToUtc(year, month, day, 0, 0, 0, timeZone);
}

export function addCivilDays(year: number, month: number, day: number, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function mondayOnOrBefore(year: number, month: number, day: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  const noon = wallClockInZoneToUtc(year, month, day, 12, 0, 0, timeZone);
  const weekday = getZonedParts(noon, timeZone).weekday;
  const mondayOffset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
  return addCivilDays(year, month, day, -mondayOffset);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

export function todayInZone(timeZone: string, now = new Date()): { year: number; month: number; day: number } {
  const parts = getZonedParts(now, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAY_SHORT_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
