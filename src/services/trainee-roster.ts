import type { CourseOutcomeResult } from "./course-outcome.service";

export type TraineeRosterRow = {
  enrollmentId: string;
  status: string;
  progress: number;
  courseOutcome: CourseOutcomeResult["outcome"];
  courseStatus: CourseOutcomeResult["courseStatus"];
  failedAssessments: CourseOutcomeResult["failedAssessments"];
  lastActivityAt: string | null;
  finishedAt: string | null;
  enrolledAt: string;
  enrolledBy: { id: string; name: string; email: string } | null;
  trainee: { id: string; name: string; email: string };
  batch: { id: string; name: string } | null;
};

export function traineeRosterCounts(trainees: Array<{ courseOutcome: string; progress: number }>) {
  return {
    total: trainees.length,
    inProgress: trainees.filter((row) => row.courseOutcome === "PENDING").length,
    completed: trainees.filter((row) => row.courseOutcome === "PASSED").length,
    failed: trainees.filter((row) => row.courseOutcome === "FAILED").length,
    notStarted: trainees.filter((row) => row.courseOutcome === "PENDING" && row.progress <= 0).length,
  };
}
