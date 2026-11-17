import { TRAINING_WORKING_DAYS, workingDayNumber, type WorkCalendar } from "../utils/working-days";

export const JOIN_WINDOW_DAYS = 3;
export const HR_ATTRITION_DAYS = 3;
export const HEADCOUNT_LOCK_DAY = 7;
export const EVALUATION_DAY = 15;

export type TraineeStage =
  | "IN_TRAINING"
  | "EXAM_PENDING"
  | "NOT_CERTIFIED"
  | "CERTIFIED"
  | "HANDED_OVER"
  | "HR_ATTRITION"
  | "LEFT"
  | "TERMINATED";

export type Attrition = "HR" | "EARLY" | "TRAINING" | null;

export type BatchTrainingStatus = "UPCOMING" | "ONGOING" | "COMPLETED";

export type FunnelTraineeInput = {
  status: string;
  joinedYmd: string;
  exitedYmd: string | null;
  courseOutcome: string;
  progress: number;
  finalExamAttempted: boolean;
  certificateStatus: "VALID" | "REVOKED" | null;
  handedOver: boolean;
};

export type FunnelBatchInput = {
  startYmd: string | null;
  actualCompletionYmd: string | null;
};

export type ClassifiedTrainee = {
  stage: TraineeStage;
  attrition: Attrition;
  joinDay: number;
  joinedLate: boolean;
  exitDay: number | null;
  appeared: boolean;
  certified: boolean;
  handedOver: boolean;
};

export type BatchFunnel = {
  actualHc: number;
  joinedLate: number;
  hrAttrition: number;
  earlyExits: number;
  day7Hc: number;
  day7Locked: boolean;
  trainingAttrition: number;
  terminated: number;
  inTraining: number;
  examPending: number;
  appeared: number;
  certified: number;
  notCertified: number;
  certifiedPct: number | null;
  handover: number;
  handoverPct: number | null;
  handoverPending: number;
  throughputPct: number | null;
};

export function percent(count: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }
  return Math.round((count / total) * 1000) / 10;
}

export function isExitedStatus(status: string): boolean {
  return status === "WITHDRAWN" || status === "TERMINATED";
}

export function trainingDay(batch: FunnelBatchInput, todayYmd: string, calendar: WorkCalendar): number {
  if (!batch.startYmd) {
    return 0;
  }
  const until = batch.actualCompletionYmd && batch.actualCompletionYmd < todayYmd ? batch.actualCompletionYmd : todayYmd;
  return Math.min(TRAINING_WORKING_DAYS, workingDayNumber(batch.startYmd, until, calendar));
}

export function batchTrainingStatus(batch: FunnelBatchInput, todayYmd: string): BatchTrainingStatus {
  if (batch.actualCompletionYmd) {
    return "COMPLETED";
  }
  if (batch.startYmd && batch.startYmd > todayYmd) {
    return "UPCOMING";
  }
  return "ONGOING";
}

export function classifyTrainee(
  trainee: FunnelTraineeInput,
  batch: FunnelBatchInput,
  calendar: WorkCalendar,
  todayYmd: string,
): ClassifiedTrainee {
  const start = batch.startYmd ?? trainee.joinedYmd;
  const joinDay = Math.max(1, workingDayNumber(start, trainee.joinedYmd, calendar));
  const joinedLate = joinDay > 1;

  if (isExitedStatus(trainee.status)) {
    const exitYmd = trainee.exitedYmd ?? todayYmd;
    const daysSinceJoin = workingDayNumber(trainee.joinedYmd, exitYmd, calendar);
    const exitDay = workingDayNumber(start, exitYmd, calendar);
    let attrition: Attrition;
    if (daysSinceJoin <= HR_ATTRITION_DAYS) {
      attrition = "HR";
    } else if (exitDay <= HEADCOUNT_LOCK_DAY) {
      attrition = "EARLY";
    } else {
      attrition = "TRAINING";
    }
    const stage: TraineeStage =
      attrition === "HR" ? "HR_ATTRITION" : trainee.status === "TERMINATED" ? "TERMINATED" : "LEFT";
    return { stage, attrition, joinDay, joinedLate, exitDay, appeared: false, certified: false, handedOver: false };
  }

  const certified =
    trainee.certificateStatus === "VALID" ||
    (trainee.courseOutcome === "PASSED" && trainee.certificateStatus !== "REVOKED");
  const appeared = certified || trainee.finalExamAttempted || trainee.courseOutcome !== "PENDING";
  const handedOver = certified && trainee.handedOver;
  const trainingDone =
    Boolean(batch.actualCompletionYmd) ||
    trainee.progress >= 100 ||
    trainingDay(batch, todayYmd, calendar) >= TRAINING_WORKING_DAYS;

  let stage: TraineeStage;
  if (handedOver) {
    stage = "HANDED_OVER";
  } else if (certified) {
    stage = "CERTIFIED";
  } else if (appeared) {
    stage = "NOT_CERTIFIED";
  } else if (trainingDone) {
    stage = "EXAM_PENDING";
  } else {
    stage = "IN_TRAINING";
  }

  return { stage, attrition: null, joinDay, joinedLate, exitDay: null, appeared, certified, handedOver };
}

export function emptyFunnel(): BatchFunnel {
  return summarizeFunnel([], false);
}

export function summarizeFunnel(rows: ClassifiedTrainee[], day7Locked: boolean): BatchFunnel {
  const count = (predicate: (row: ClassifiedTrainee) => boolean) => rows.filter(predicate).length;
  const actualHc = rows.length;
  const hrAttrition = count((row) => row.attrition === "HR");
  const earlyExits = count((row) => row.attrition === "EARLY");
  const day7Hc = actualHc - hrAttrition - earlyExits;
  const appeared = count((row) => row.appeared);
  const certified = count((row) => row.certified);
  const handover = count((row) => row.handedOver);
  return {
    actualHc,
    joinedLate: count((row) => row.joinedLate),
    hrAttrition,
    earlyExits,
    day7Hc,
    day7Locked,
    trainingAttrition: count((row) => row.attrition === "TRAINING"),
    terminated: count((row) => row.stage === "TERMINATED"),
    inTraining: count((row) => row.stage === "IN_TRAINING"),
    examPending: count((row) => row.stage === "EXAM_PENDING"),
    appeared,
    certified,
    notCertified: count((row) => row.stage === "NOT_CERTIFIED"),
    certifiedPct: percent(certified, appeared),
    handover,
    handoverPct: percent(handover, certified),
    handoverPending: certified - handover,
    throughputPct: percent(certified, day7Hc),
  };
}

export function combineFunnels(funnels: BatchFunnel[]): BatchFunnel {
  const sum = (key: keyof BatchFunnel) =>
    funnels.reduce((total, funnel) => total + (typeof funnel[key] === "number" ? (funnel[key] as number) : 0), 0);
  const appeared = sum("appeared");
  const certified = sum("certified");
  const handover = sum("handover");
  const day7Hc = sum("day7Hc");
  return {
    actualHc: sum("actualHc"),
    joinedLate: sum("joinedLate"),
    hrAttrition: sum("hrAttrition"),
    earlyExits: sum("earlyExits"),
    day7Hc,
    day7Locked: funnels.every((funnel) => funnel.day7Locked),
    trainingAttrition: sum("trainingAttrition"),
    terminated: sum("terminated"),
    inTraining: sum("inTraining"),
    examPending: sum("examPending"),
    appeared,
    certified,
    notCertified: sum("notCertified"),
    certifiedPct: percent(certified, appeared),
    handover,
    handoverPct: percent(handover, certified),
    handoverPending: certified - handover,
    throughputPct: percent(certified, day7Hc),
  };
}
