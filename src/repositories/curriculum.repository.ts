import { prisma } from "../config/prisma";

export const curriculumRepository = {
  week(id: string) {
    return prisma.week.findUnique({ where: { id }, include: { program: true } });
  },
  day(id: string) {
    return prisma.day.findUnique({
      where: { id },
      include: { week: { include: { program: true } } },
    });
  },
  lesson(id: string) {
    return prisma.lesson.findUnique({
      where: { id },
      include: { day: { include: { week: { include: { program: true } } } } },
    });
  },
  video(id: string) {
    return prisma.video.findUnique({
      where: { id },
      include: { day: { include: { week: { include: { program: true } } } } },
    });
  },
  resource(id: string) {
    return prisma.resource.findUnique({
      where: { id },
      include: { day: { include: { week: { include: { program: true } } } } },
    });
  },
  reel(id: string) {
    return prisma.reel.findUnique({
      where: { id },
      include: { day: { include: { week: { include: { program: true } } } } },
    });
  },
  assignment(id: string) {
    return prisma.assignment.findUnique({
      where: { id },
      include: { day: { include: { week: { include: { program: true } } } } },
    });
  },
  quiz(id: string) {
    return prisma.quiz.findUnique({
      where: { id },
      include: {
        day: { include: { week: { include: { program: true } } } },
        week: { include: { program: true } },
        milestone: { include: { program: true } },
        program: true,
      },
    });
  },
  milestone(id: string) {
    return prisma.milestone.findUnique({ where: { id }, include: { program: true } });
  },
  requirement(id: string) {
    return prisma.milestoneRequirement.findUnique({
      where: { id },
      include: { milestone: { include: { program: true } } },
    });
  },
  session(id: string) {
    return prisma.trainingSession.findUnique({
      where: { id },
      include: { week: { include: { program: true } } },
    });
  },
  async nextWeekOrder(programId: string) {
    const result = await prisma.week.aggregate({ where: { programId }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextDayOrder(weekId: string) {
    const result = await prisma.day.aggregate({ where: { weekId }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextLessonOrder(dayId: string) {
    const result = await prisma.lesson.aggregate({ where: { dayId }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextVideoOrder(dayId: string) {
    const result = await prisma.video.aggregate({ where: { dayId }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextResourceOrder(dayId: string) {
    const result = await prisma.resource.aggregate({ where: { dayId }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextReelOrder(dayId: string) {
    const result = await prisma.reel.aggregate({ where: { dayId }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextAssignmentOrder(dayId: string) {
    const result = await prisma.assignment.aggregate({ where: { dayId }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextMilestoneOrder(programId: string) {
    const result = await prisma.milestone.aggregate({ where: { programId }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextRequirementOrder(milestoneId: string) {
    const result = await prisma.milestoneRequirement.aggregate({
      where: { milestoneId },
      _max: { sortOrder: true },
    });
    return (result._max.sortOrder ?? -1) + 1;
  },
  async nextSessionOrder(weekId: string) {
    const result = await prisma.trainingSession.aggregate({
      where: { weekId },
      _max: { sortOrder: true },
    });
    return (result._max.sortOrder ?? -1) + 1;
  },
};
