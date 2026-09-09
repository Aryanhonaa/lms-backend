import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  buildBatchCode,
  countWorkingDaysInclusive,
  currentTrainingDay,
  safePercent,
} from "../src/utils/working-days";

describe("working day tracker rules", () => {
  it("skips weekends when counting training days", () => {
    const monday = new Date("2026-08-31T00:00:00.000Z");
    const nextMonday = new Date("2026-09-07T00:00:00.000Z");
    expect(countWorkingDaysInclusive(monday, nextMonday)).toBe(6);
    expect(currentTrainingDay(monday, nextMonday)).toBe(6);
    expect(addWorkingDays(monday, 24).toISOString().slice(0, 10)).toBe("2026-10-02");
  });

  it("builds batch codes and guards division by zero", () => {
    expect(buildBatchCode(9, 2026, 5)).toBe("NHT-SEP-2026-05");
    expect(safePercent(8, 10)).toBe(80);
    expect(safePercent(3, 0)).toBeNull();
  });
});
