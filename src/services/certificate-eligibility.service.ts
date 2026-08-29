import {
  FeedbackTargetKind,
  IndividualRequirementStatus,
  MilestoneRequirementKind,
  ProgramTrainerRole,
  QuizKind,
} from "../generated/prisma";
import { prisma } from "../config/prisma";
import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programRepository } from "../repositories/program.repository";
import { quizState, assignmentFullyComplete, isLiveAssignment, type ProgramTree } from "./unlock.service";
import { ApiError } from "../utils/api-error";

const REQUIRED_ASSESSMENT_KINDS: QuizKind[] = [
  QuizKind.PRACTICE_QUIZ,
  QuizKind.WEEKLY_QUIZ,
  QuizKind.WEEKLY_EXAM,
  QuizKind.MILESTONE_EXAM,
];

export type CertificateRequirement = {
  key: string;
  label: string;
  met: boolean;
};

export type CertificateEligibility = {
  enrollmentId: string;
  eligible: boolean;
  requirements: CertificateRequirement[];
  progressPercent: number;
  finalScore: number;
  trainee: { id: string; name: string };
  program: { id: string; title: string };
  trainer: { id: string; name: string };
};

function collectQuizzes(program: ProgramTree) {
  const rows = [
    ...program.quizzes,
    ...program.weeks.flatMap((week) => week.quizzes),
    ...program.weeks.flatMap((week) => week.days.flatMap((day) => day.quizzes)),
    ...program.milestones.flatMap((milestone) => (milestone.exam ? [milestone.exam] : [])),
  ];
  const seen = new Set<string>();
  return rows.filter((quiz) => {
    if (seen.has(quiz.id)) {
      return false;
    }
    seen.add(quiz.id);
    return true;
  });
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export const COURSE_REVIEW_REQUIREMENT_KEY = "COURSE_REVIEW";

export function academicRequirementsMet(requirements: CertificateRequirement[]): boolean {
  return requirements.filter((row) => row.key !== COURSE_REVIEW_REQUIREMENT_KEY).every((row) => row.met);
}

export const certificateEligibilityService = {
  async evaluate(enrollmentId: string): Promise<CertificateEligibility> {
    const enrollment = await enrollmentRepository.findFactsById(enrollmentId);
    if (!enrollment) {
      throw ApiError.notFound("Enrollment not found");
    }
    const program = await programRepository.findTreeById(enrollment.programId);
    if (!program) {
      throw ApiError.notFound("Program not found");
    }

    const { progressService } = await import("./progress.service");
    const facts = progressService.factsFromEnrollment(enrollment);
    const view = progressService.compute(program, enrollment.id, facts);
    const trainee = await prisma.user.findUniqueOrThrow({
      where: { id: enrollment.userId },
      select: { id: true, name: true },
    });

    const owner =
      program.trainers.find((row) => row.role === ProgramTrainerRole.OWNER)?.user ?? program.createdBy;

    const quizzes = collectQuizzes(program);
    const requirements: CertificateRequirement[] = [
      {
        key: "PROGRAM_COMPLETION",
        label: "Course passed",
        met: view.course.outcome === "PASSED",
      },
    ];

    for (const quiz of quizzes.filter((item) => REQUIRED_ASSESSMENT_KINDS.includes(item.kind))) {
      requirements.push({
        key: `ASSESSMENT:${quiz.id}`,
        label: `${quiz.title} passed`,
        met: quizState(facts, quiz.id).passed,
      });
    }

    for (const milestone of view.milestones) {
      requirements.push({
        key: `MILESTONE:${milestone.id}`,
        label: `${milestone.title} complete`,
        met: milestone.satisfied,
      });
      for (const requirement of milestone.requirements) {
        if (requirement.kind === MilestoneRequirementKind.ATTENDANCE) {
          requirements.push({
            key: `ATTENDANCE:${requirement.label}`,
            label: requirement.label,
            met: requirement.complete,
          });
        }
      }
    }

    for (const week of program.weeks) {
      for (const day of week.days) {
        for (const assignment of day.assignments.filter(isLiveAssignment)) {
          requirements.push({
            key: `ASSIGNMENT:${assignment.id}`,
            label: `${assignment.title} graded`,
            met: assignmentFullyComplete(facts, assignment.id),
          });
        }
      }
    }

    const finalQuiz = quizzes.find((quiz) => quiz.kind === QuizKind.FINAL_EXAM) ?? null;
    if (finalQuiz) {
      requirements.push({
        key: "FINAL_EXAM",
        label: `${finalQuiz.title} passed`,
        met: quizState(facts, finalQuiz.id).passed,
      });
    }

    const openRequirements = await prisma.individualRequirement.count({
      where: {
        enrollmentId,
        status: { not: IndividualRequirementStatus.COMPLETED },
      },
    });
    requirements.push({
      key: "INDIVIDUAL_REQUIREMENTS",
      label: "No unresolved individual requirements",
      met: openRequirements === 0,
    });

    const courseReview = await prisma.feedback.findFirst({
      where: {
        enrollmentId,
        targetKind: FeedbackTargetKind.COURSE,
      },
      select: { id: true },
    });
    requirements.push({
      key: COURSE_REVIEW_REQUIREMENT_KEY,
      label: "Course review submitted",
      met: Boolean(courseReview),
    });

    const eligible = requirements.every((row) => row.met);
    const examScore = finalQuiz ? quizState(facts, finalQuiz.id).bestScore : null;
    const finalScore = roundScore(examScore ?? view.progress.percent);

    return {
      enrollmentId,
      eligible,
      requirements,
      progressPercent: view.progress.percent,
      finalScore,
      trainee,
      program: { id: program.id, title: program.title },
      trainer: { id: owner.id, name: owner.name },
    };
  },
};
