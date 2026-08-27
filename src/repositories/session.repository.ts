import { prisma } from "../config/prisma";

export const sessionRepository = {
  create(input: { tokenHash: string; userId: string; expiresAt: Date }) {
    return prisma.session.create({ data: input });
  },

  findByTokenHash(tokenHash: string) {
    return prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  },

  deleteById(id: string) {
    return prisma.session.delete({ where: { id } });
  },

  deleteByTokenHash(tokenHash: string) {
    return prisma.session.deleteMany({ where: { tokenHash } });
  },

  deleteExpired() {
    return prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  },
};
