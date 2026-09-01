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

  async replaceCoTrainers(programId: string, ownerUserId: string, coTrainerIds: string[]) {
    const keepIds = [ownerUserId, ...coTrainerIds];
    await prisma.$transaction(async (tx) => {
      await tx.programTrainer.deleteMany({
        where: {
          programId,
          userId: { notIn: keepIds },
        },
      });
      await tx.programTrainer.upsert({
        where: { programId_userId: { programId, userId: ownerUserId } },
        create: { programId, userId: ownerUserId, role: "OWNER" },
        update: { role: "OWNER" },
      });
      for (const userId of coTrainerIds) {
        await tx.programTrainer.upsert({
          where: { programId_userId: { programId, userId } },
          create: { programId, userId, role: "CO_TRAINER" },
          update: { role: "CO_TRAINER" },
        });
      }
    });
  },
};
