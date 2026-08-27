import { prisma } from "../config/prisma";
import type { Role } from "../generated/prisma";

export const userPublicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  avatarUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const userRepository = {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  },

  findPublicById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: userPublicSelect,
    });
  },

  listPublic() {
    return prisma.user.findMany({
      select: userPublicSelect,
      orderBy: { createdAt: "asc" },
    });
  },

  listPublicByRoles(roles: Role[]) {
    return prisma.user.findMany({
      where: { role: { in: roles } },
      select: userPublicSelect,
      orderBy: { createdAt: "asc" },
    });
  },

  searchTrainees(query: string, skip: number, take: number) {
    const q = query.trim();
    return prisma.user.findMany({
      where: {
        role: "TRAINEE",
        isActive: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      skip,
      take,
    });
  },

  countTrainees(query: string) {
    const q = query.trim();
    return prisma.user.count({
      where: {
        role: "TRAINEE",
        isActive: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    });
  },

  listActiveIdsByRole(role: Role) {
    return prisma.user.findMany({
      where: { role, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  },

  create(input: { name: string; email: string; passwordHash: string; role: Role }) {
    return prisma.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
      },
      select: userPublicSelect,
    });
  },

  updateAvatar(userId: string, avatarUrl: string | null) {
    return prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: userPublicSelect,
    });
  },

  countByRole(role: Role) {
    return prisma.user.count({ where: { role } });
  },

  deletionBlockers(userId: string) {
    return Promise.all([
      prisma.program.count({ where: { createdByUserId: userId } }),
      prisma.announcement.count({ where: { createdByUserId: userId } }),
      prisma.attendance.count({ where: { markedByUserId: userId } }),
      prisma.individualRequirement.count({ where: { assignedByUserId: userId } }),
      prisma.certificate.count({ where: { trainerUserId: userId } }),
    ]).then(
      ([createdPrograms, announcements, markedAttendances, assignedRequirements, issuedCertificates]) => ({
        createdPrograms,
        announcements,
        markedAttendances,
        assignedRequirements,
        issuedCertificates,
      }),
    );
  },

  deleteOwnedRecords(userId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.feedback.deleteMany({ where: { authorUserId: userId } });
      await tx.programTrainer.deleteMany({ where: { userId } });
      await tx.certificate.deleteMany({ where: { traineeUserId: userId } });
      await tx.enrollment.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  },
};
