import { prisma } from "../config/prisma";

export const programTrainerRepository = {
  findByProgram(programId: string) {
    return prisma.programTrainer.findMany({
      where: { programId },
      include: { user: true },
    });
  },

  findAssignment(programId: string, userId: string) {
    return prisma.programTrainer.findUnique({
      where: {
        programId_userId: { programId, userId },
      },
    });
  },
};
