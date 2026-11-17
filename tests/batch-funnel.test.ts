import { describe, expect, it } from "vitest";
import {
  batchTrainingStatus,
  classifyTrainee,
  combineFunnels,
  summarizeFunnel,
  trainingDay,
  type FunnelTraineeInput,
} from "../src/services/batch-funnel";
import { buildBatchCode } from "../src/utils/batch-code";
import { addWorkingDays, skippedDays, workingDayNumber, type WorkCalendar } from "../src/utils/working-days";

const saturdaysOff: WorkCalendar = { weeklyOffDays: [6], holidays: new Set() };
const withHoliday: WorkCalendar = { weeklyOffDays: [6], holidays: new Set(["2026-10-20"]) };
const batch = { startYmd: "2026-10-01", actualCompletionYmd: null };

function trainee(overrides: Partial<FunnelTraineeInput> = {}): FunnelTraineeInput {
  return {
    status: "ACTIVE",
    joinedYmd: "2026-10-01",
    exitedYmd: null,
    courseOutcome: "PENDING",
    progress: 40,
    finalExamAttempted: false,
    certificateStatus: null,
    handedOver: false,
    ...overrides,
  };
}

describe("working days", () => {
  it("skips Saturdays when counting 25 training days", () => {
    expect(addWorkingDays("2026-10-01", 25, saturdaysOff)).toBe("2026-10-29");
  });

  it("pushes the target out by one day for each holiday", () => {
    expect(addWorkingDays("2026-10-01", 25, withHoliday)).toBe("2026-10-30");
    expect(skippedDays("2026-10-01", "2026-10-30", withHoliday)).toEqual({ weeklyOff: 4, holidays: ["2026-10-20"] });
  });

  it("numbers training days from the batch start", () => {
    expect(workingDayNumber("2026-10-01", "2026-10-01", saturdaysOff)).toBe(1);
    expect(workingDayNumber("2026-10-01", "2026-10-08", saturdaysOff)).toBe(7);
    expect(workingDayNumber("2026-10-01", "2026-09-30", saturdaysOff)).toBe(0);
  });

  it("treats a start on a day off as not yet started", () => {
    expect(addWorkingDays("2026-10-03", 1, saturdaysOff)).toBe("2026-10-04");
  });
});

describe("batch code", () => {
  it("formats NHT month-year-number codes", () => {
    expect(buildBatchCode(10, 2026, 3)).toBe("NHT-OCT26-03");
    expect(buildBatchCode(1, 2027, 12)).toBe("NHT-JAN27-12");
  });
});

describe("trainee classification", () => {
  const today = "2026-11-05";

  it("counts exits within 3 days of joining as HR attrition", () => {
    const row = classifyTrainee(
      trainee({ status: "WITHDRAWN", exitedYmd: "2026-10-02" }),
      batch,
      saturdaysOff,
      today,
    );
    expect(row.stage).toBe("HR_ATTRITION");
    expect(row.attrition).toBe("HR");
  });

  it("measures HR attrition from the trainee's own joining date", () => {
    const row = classifyTrainee(
      trainee({ joinedYmd: "2026-10-05", status: "WITHDRAWN", exitedYmd: "2026-10-07" }),
      batch,
      saturdaysOff,
      today,
    );
    expect(row.attrition).toBe("HR");
    expect(row.joinedLate).toBe(true);
  });

  it("separates exits before Day 7 from training attrition", () => {
    const early = classifyTrainee(
      trainee({ status: "WITHDRAWN", exitedYmd: "2026-10-08" }),
      batch,
      saturdaysOff,
      today,
    );
    expect(early.attrition).toBe("EARLY");

    const terminated = classifyTrainee(
      trainee({ status: "TERMINATED", exitedYmd: "2026-10-20" }),
      batch,
      saturdaysOff,
      today,
    );
    expect(terminated.attrition).toBe("TRAINING");
    expect(terminated.stage).toBe("TERMINATED");
  });

  it("treats a passed course as certified unless the certificate was revoked", () => {
    const passed = classifyTrainee(trainee({ courseOutcome: "PASSED" }), batch, saturdaysOff, today);
    expect(passed.stage).toBe("CERTIFIED");

    const revoked = classifyTrainee(
      trainee({ courseOutcome: "PASSED", certificateStatus: "REVOKED", finalExamAttempted: true }),
      batch,
      saturdaysOff,
      today,
    );
    expect(revoked.certified).toBe(false);
    expect(revoked.stage).toBe("NOT_CERTIFIED");
  });

  it("marks trainees awaiting the exam once 25 days have passed", () => {
    const row = classifyTrainee(trainee(), batch, saturdaysOff, today);
    expect(row.stage).toBe("EXAM_PENDING");
    const midway = classifyTrainee(trainee(), batch, saturdaysOff, "2026-10-12");
    expect(midway.stage).toBe("IN_TRAINING");
  });

  it("only counts handover for certified trainees", () => {
    const row = classifyTrainee(trainee({ handedOver: true }), batch, saturdaysOff, today);
    expect(row.handedOver).toBe(false);
  });
});

describe("batch funnel", () => {
  const today = "2026-11-05";
  const rows = [
    trainee({ status: "WITHDRAWN", exitedYmd: "2026-10-02" }),
    trainee({ status: "TERMINATED", exitedYmd: "2026-10-19" }),
    trainee({ joinedYmd: "2026-10-02", courseOutcome: "FAILED", finalExamAttempted: true }),
    ...Array.from({ length: 5 }, () =>
      trainee({ courseOutcome: "PASSED", certificateStatus: "VALID", finalExamAttempted: true, handedOver: true }),
    ),
    trainee({ courseOutcome: "PASSED", certificateStatus: "VALID", finalExamAttempted: true }),
    trainee(),
  ].map((row) => classifyTrainee(row, batch, saturdaysOff, today));

  it("matches the training team's sheet columns", () => {
    const funnel = summarizeFunnel(rows, true);
    expect(funnel).toMatchObject({
      actualHc: 10,
      joinedLate: 1,
      hrAttrition: 1,
      day7Hc: 9,
      trainingAttrition: 1,
      terminated: 1,
      appeared: 7,
      certified: 6,
      certifiedPct: 85.7,
      handover: 5,
      handoverPending: 1,
      throughputPct: 66.7,
      examPending: 1,
    });
  });

  it("recomputes percentages from summed counts across batches", () => {
    const combined = combineFunnels([summarizeFunnel(rows, true), summarizeFunnel(rows.slice(0, 2), true)]);
    expect(combined.actualHc).toBe(12);
    expect(combined.day7Hc).toBe(10);
    expect(combined.throughputPct).toBe(60);
  });

  it("returns null percentages when nobody is in the denominator", () => {
    expect(summarizeFunnel([], false).certifiedPct).toBeNull();
  });
});

describe("batch status", () => {
  it("reports upcoming, ongoing and completed batches", () => {
    expect(batchTrainingStatus(batch, "2026-09-30")).toBe("UPCOMING");
    expect(batchTrainingStatus(batch, "2026-10-10")).toBe("ONGOING");
    expect(batchTrainingStatus({ ...batch, actualCompletionYmd: "2026-10-29" }, "2026-10-30")).toBe("COMPLETED");
  });

  it("caps the training day at 25", () => {
    expect(trainingDay(batch, "2026-10-12", saturdaysOff)).toBe(10);
    expect(trainingDay(batch, "2026-12-01", saturdaysOff)).toBe(25);
  });
});
