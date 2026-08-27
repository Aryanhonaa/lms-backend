import { prisma } from "../config/prisma";

export const appUsageRepository = {
  findOpenByUser(userId: string) {
    return prisma.appUsageSession.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
  },

  create(input: {
    userId: string;
    startedAt: Date;
    lastHeartbeatAt: Date;
    durationSeconds: number;
    programId?: string | null;
    batchId?: string | null;
  }) {
    return prisma.appUsageSession.create({ data: input });
  },

  update(
    id: string,
    data: {
      lastHeartbeatAt?: Date;
      endedAt?: Date | null;
      durationSeconds?: number;
      programId?: string | null;
      batchId?: string | null;
    },
  ) {
    return prisma.appUsageSession.update({ where: { id }, data });
  },

  findOverlapping(input: { userIds: string[]; rangeStart: Date; rangeEnd: Date }) {
    return prisma.appUsageSession.findMany({
      where: {
        userId: { in: input.userIds },
        startedAt: { lt: input.rangeEnd },
        OR: [{ endedAt: null }, { endedAt: { gte: input.rangeStart } }, { lastHeartbeatAt: { gte: input.rangeStart } }],
      },
      select: {
        userId: true,
        startedAt: true,
        lastHeartbeatAt: true,
        endedAt: true,
        durationSeconds: true,
      },
    });
  },
};
