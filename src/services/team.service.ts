import { LineOfBusiness, Prisma } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { ApiError } from "../utils/api-error";

type TeamInput = {
  name?: string;
  lineOfBusiness?: LineOfBusiness | null;
  supervisorName?: string;
  isActive?: boolean;
};

function toTeam(row: {
  id: string;
  name: string;
  lineOfBusiness: LineOfBusiness | null;
  supervisorName: string;
  isActive: boolean;
  _count?: { enrollments: number };
}) {
  return {
    id: row.id,
    name: row.name,
    lineOfBusiness: row.lineOfBusiness,
    supervisorName: row.supervisorName,
    isActive: row.isActive,
    memberCount: row._count?.enrollments ?? 0,
  };
}

function rethrowDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw ApiError.conflict("A team with that name already exists.");
  }
  throw error;
}

export const teamService = {
  async list() {
    const rows = await prisma.team.findMany({
      include: { _count: { select: { enrollments: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return { teams: rows.map(toTeam) };
  },

  async create(input: TeamInput) {
    const name = input.name?.trim();
    if (!name) {
      throw ApiError.badRequest("A team name is required.");
    }
    try {
      const row = await prisma.team.create({
        data: {
          name,
          lineOfBusiness: input.lineOfBusiness ?? null,
          supervisorName: input.supervisorName?.trim() ?? "",
        },
      });
      return { team: toTeam(row) };
    } catch (error) {
      rethrowDuplicate(error);
    }
  },

  async update(id: string, input: TeamInput) {
    const existing = await prisma.team.findUnique({ where: { id } });
    if (!existing) {
      throw ApiError.notFound("Team not found");
    }
    try {
      const row = await prisma.team.update({
        where: { id },
        data: {
          ...(input.name !== undefined && input.name.trim() ? { name: input.name.trim() } : {}),
          ...("lineOfBusiness" in input ? { lineOfBusiness: input.lineOfBusiness ?? null } : {}),
          ...(input.supervisorName !== undefined ? { supervisorName: input.supervisorName.trim() } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      return { team: toTeam(row) };
    } catch (error) {
      rethrowDuplicate(error);
    }
  },
};
