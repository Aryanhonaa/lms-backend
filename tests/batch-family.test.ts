import { describe, expect, it } from "vitest";
import { familyCourseOutcome } from "../src/services/batch-family.service";

describe("familyCourseOutcome", () => {
  it("is pending when a linked course has no enrollment yet", () => {
    expect(familyCourseOutcome({ courseOutcome: "PASSED" }, [undefined])).toBe("PENDING");
  });

  it("is pending until every course in the batch is passed", () => {
    expect(
      familyCourseOutcome({ courseOutcome: "PASSED" }, [{ courseOutcome: "PENDING" }]),
    ).toBe("PENDING");
  });

  it("is passed only when every linked course passed", () => {
    expect(
      familyCourseOutcome({ courseOutcome: "PASSED" }, [{ courseOutcome: "PASSED" }]),
    ).toBe("PASSED");
  });
});
