import { Prisma } from "../generated/prisma";
import { prisma } from "../config/prisma";
import { ApiError } from "../utils/api-error";
import { DEFAULT_WEEKLY_OFF_DAYS, type WorkCalendar } from "../utils/working-days";

function holidayYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeOffDays(days: number[]): number[] {
  return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
}

export const workCalendarService = {
  async load(): Promise<WorkCalendar> {
    const [setting, holidays] = await Promise.all([
      prisma.workCalendarSetting.findUnique({ where: { id: 1 } }),
      prisma.holiday.findMany({ select: { date: true } }),
    ]);
    return {
      weeklyOffDays: setting?.weeklyOffDays ?? DEFAULT_WEEKLY_OFF_DAYS,
      holidays: new Set(holidays.map((row) => holidayYmd(row.date))),
    };
  },

  async get() {
    const [setting, holidays] = await Promise.all([
      prisma.workCalendarSetting.findUnique({ where: { id: 1 } }),
      prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    ]);
    return {
      weeklyOffDays: setting?.weeklyOffDays ?? DEFAULT_WEEKLY_OFF_DAYS,
      holidays: holidays.map((row) => ({ id: row.id, date: holidayYmd(row.date), name: row.name })),
    };
  },

  async setWeeklyOffDays(days: number[]) {
    const weeklyOffDays = normalizeOffDays(days);
    if (weeklyOffDays.length >= 7) {
      throw ApiError.badRequest("At least one day of the week must be a working day.");
    }
    await prisma.workCalendarSetting.upsert({
      where: { id: 1 },
      create: { id: 1, weeklyOffDays },
      update: { weeklyOffDays },
    });
    return this.get();
  },

  async addHolidays(rows: Array<{ date: string; name: string }>) {
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) {
        throw ApiError.badRequest("Each holiday needs a name.");
      }
      try {
        await prisma.holiday.upsert({
          where: { date: new Date(`${row.date}T00:00:00Z`) },
          create: { date: new Date(`${row.date}T00:00:00Z`), name },
          update: { name },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }
    return this.get();
  },

  async removeHoliday(id: string) {
    const existing = await prisma.holiday.findUnique({ where: { id } });
    if (!existing) {
      throw ApiError.notFound("Holiday not found");
    }
    await prisma.holiday.delete({ where: { id } });
    return this.get();
  },
};
