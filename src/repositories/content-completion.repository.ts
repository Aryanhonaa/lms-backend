import type { ContentItemType } from "../generated/prisma";
import { prisma } from "../config/prisma";

export const contentCompletionRepository = {
  listByEnrollment(enrollmentId: string) {
    return prisma.contentCompletion.findMany({
      where: { enrollmentId },
    });
  },

  upsert(enrollmentId: string, itemType: ContentItemType, itemId: string) {
    return prisma.contentCompletion.upsert({
      where: {
        enrollmentId_itemType_itemId: { enrollmentId, itemType, itemId },
      },
      create: { enrollmentId, itemType, itemId },
      update: { completedAt: new Date() },
    });
  },
};
