import { BatchTrainerRole, EnrollmentStatus, LineOfBusiness, Prisma, ProgramStatus, Role } from "../generated/prisma";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { programBatchRepository } from "../repositories/program-batch.repository";
import { DEFAULT_BATCH_CAPACITY, enrollmentService } from "./enrollment.service";
import { programService } from "./program.service";
import { workCalendarService } from "./work-calendar.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { buildBatchCode } from "../utils/batch-code";
import { isProgramReviewer } from "../utils/roles";
import { zonedYmd } from "../utils/timezone";
import { TRAINING_WORKING_DAYS, addWorkingDays, skippedDays } from "../utils/working-days";
import { orderedBatchCourses } from "../utils/course-sequence";

const BATCHABLE_STATUSES: ProgramStatus[] = [ProgramStatus.APPROVED, ProgramStatus.PUBLISHED];

type BatchInput = {
  name?: string;
  description?: string;
  capacity?: number;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  lineOfBusiness?: LineOfBusiness | null;
  month?: number | null;
  year?: number | null;
  batchNumber?: number | null;
  salesTrainerId?: string | null;
  supportTrainerId?: string | null;
  collaboratorIds?: string[];
  programIds?: string[];
  actualCompletionDate?: string | Date | null;
};

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function ymd(date: Date): string {
  return zonedYmd(date, env.timezone);
}

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function uniqueTargetFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.map(String);
  }
  if (typeof target === "string") {
    return [target];
  }
  return [];
}

function throwBatchUniqueConflict(error: Prisma.PrismaClientKnownRequestError): never {
  const fields = uniqueTargetFields(error);
  if (fields.some((field) => field === "code" || field.endsWith("_code") || field.includes("code"))) {
    throw ApiError.conflict(
      "That batch code is already in use. Leave batch number blank to auto-assign, or pick a different number.",
    );
  }
  if (fields.some((field) => field === "name" || field.includes("name"))) {
    throw ApiError.conflict("A batch with that name already exists for one of these courses. Choose a different name.");
  }
  throw ApiError.conflict("A batch with that name or code already exists.");
}

async function uniqueNameForProgram(programId: string, baseName: string): Promise<string> {
  const exists = async (name: string) =>
    Boolean(await prisma.programBatch.findFirst({ where: { programId, name }, select: { id: true } }));
  if (!(await exists(baseName))) {
    return baseName;
  }
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${baseName} (${n})`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  return `${baseName} · ${Date.now()}`;
}

type BatchRow = {
  id: string;
  programId: string;
  name: string;
  description: string;
  capacity: number;
  startDate: Date | null;
  endDate: Date | null;
  code: string | null;
  month: number | null;
  year: number | null;
  batchNumber: number | null;
  lineOfBusiness: LineOfBusiness | null;
  actualCompletionDate: Date | null;
  sortOrder?: number;
  createdAt: Date;
  updatedAt: Date;
  trainers?: Array<{ role: BatchTrainerRole; user: { id: string; name: string; email: string } }>;
  linkedBatches?: Array<{
    id: string;
    programId: string;
    sortOrder?: number | null;
    createdAt?: Date;
    program: { id: string; title: string };
  }>;
  program?: { id: string; title: string; status?: string };
  _count?: { enrollments: number };
};

function courseList(row: BatchRow) {
  return orderedBatchCourses({
    id: row.id,
    programId: row.programId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    program: row.program ?? { id: row.programId, title: "" },
    linkedBatches: row.linkedBatches,
  });
}

function toBatchPayload(row: BatchRow) {
  const memberCount = row._count?.enrollments ?? 0;
  const trainerFor = (role: BatchTrainerRole) => row.trainers?.find((item) => item.role === role)?.user ?? null;
  const lead = trainerFor(BatchTrainerRole.SALES);
  const collaborators = (row.trainers ?? [])
    .filter((item) => item.role !== BatchTrainerRole.SALES)
    .map((item) => item.user)
    .filter((user, index, list) => list.findIndex((row) => row.id === user.id) === index);
  return {
    id: row.id,
    programId: row.programId,
    name: row.name,
    description: row.description,
    capacity: row.capacity,
    startDate: row.startDate,
    endDate: row.endDate,
    code: row.code,
    month: row.month,
    year: row.year,
    batchNumber: row.batchNumber,
    lineOfBusiness: row.lineOfBusiness,
    actualCompletionDate: row.actualCompletionDate,
    salesTrainer: lead,
    supportTrainer: collaborators[0] ?? null,
    collaborators,
    courses: courseList(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    memberCount,
    remaining: Math.max(0, row.capacity - memberCount),
  };
}

async function requireBatchAccess(user: AuthUser, batchId: string) {
  const batch = await programBatchRepository.findById(batchId);
  if (!batch) {
    throw ApiError.notFound("Batch not found");
  }
  if (isProgramReviewer(user.role)) {
    await programService.requireCanView(user, batch.programId);
    return batch;
  }
  if (user.role !== Role.TRAINER) {
    throw ApiError.forbidden();
  }
  if (batch.createdByUserId === user.id || batch.trainers.some((trainer) => trainer.userId === user.id)) {
    return batch;
  }
  await programService.requireTrainerOnProgram(user, batch.programId);
  return batch;
}

function canManageBatch(
  user: AuthUser,
  batch: { createdByUserId: string; trainers: Array<{ userId: string }> },
): boolean {
  if (user.role !== Role.TRAINER) {
    return true;
  }
  if (batch.trainers.length === 0 || batch.createdByUserId === user.id) {
    return true;
  }
  return batch.trainers.some((trainer) => trainer.userId === user.id);
}

function batchLeadUserId(batch: {
  createdByUserId: string;
  trainers: Array<{ userId: string; role: BatchTrainerRole }>;
}): string {
  return batch.trainers.find((row) => row.role === BatchTrainerRole.SALES)?.userId ?? batch.createdByUserId;
}

function canEditBatchTeam(
  user: AuthUser,
  batch: { createdByUserId: string; trainers: Array<{ userId: string; role: BatchTrainerRole }> },
): boolean {
  if (user.role !== Role.TRAINER) {
    return true;
  }
  return batchLeadUserId(batch) === user.id;
}

async function requireBatchManage(user: AuthUser, batchId: string) {
  const batch = await requireBatchAccess(user, batchId);
  if (!canManageBatch(user, batch)) {
    throw ApiError.forbidden("Only this batch's trainers can change its trainees.");
  }
  return batch;
}

async function assertActiveTrainer(userId: string | null | undefined) {
  if (!userId) {
    return;
  }
  const trainer = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!trainer || trainer.role !== Role.TRAINER || !trainer.isActive) {
    throw ApiError.badRequest("Pick an active trainer.");
  }
}

async function assertBatchableProgram(programId: string, user?: AuthUser) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true, title: true, status: true, createdByUserId: true },
  });
  if (!program) {
    throw ApiError.notFound("Course not found");
  }
  if (!BATCHABLE_STATUSES.includes(program.status)) {
    throw ApiError.badRequest("Only admin-approved courses can be added to a batch.");
  }
  if (user?.role === Role.TRAINER) {
    await programService.requireTrainerOnProgram(user, programId);
  }
  return program;
}

function validateCapacity(capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
    throw ApiError.badRequest("Capacity must be between 1 and 200.");
  }
}

async function resolveCodeParts(input: BatchInput, startDate: Date | null) {
  const anchor = startDate ? ymd(startDate) : ymd(new Date());
  const month = input.month ?? Number(anchor.slice(5, 7));
  const year = input.year ?? Number(anchor.slice(0, 4));
  const batchNumber = input.batchNumber ?? (await programBatchRepository.nextBatchNumber(month, year));
  return { month, year, batchNumber, code: buildBatchCode(month, year, batchNumber) };
}

async function applyTrainers(_programId: string, batchId: string, input: BatchInput) {
  const touchingTeam =
    "salesTrainerId" in input || "supportTrainerId" in input || "collaboratorIds" in input;
  if (!touchingTeam) {
    return;
  }

  const current = await programBatchRepository.findById(batchId);
  const currentLead = current?.trainers.find((row) => row.role === BatchTrainerRole.SALES)?.userId ?? null;
  const currentCollaborators = (current?.trainers ?? [])
    .filter((row) => row.role !== BatchTrainerRole.SALES)
    .map((row) => row.userId);

  const leadId = "salesTrainerId" in input ? input.salesTrainerId ?? null : currentLead;
  const collaboratorIds =
    "collaboratorIds" in input || "supportTrainerId" in input
      ? [
          ...("collaboratorIds" in input ? (input.collaboratorIds ?? []) : currentCollaborators),
          ...("supportTrainerId" in input && input.supportTrainerId ? [input.supportTrainerId] : []),
        ]
      : currentCollaborators;
  const uniqueCollaborators = [...new Set(collaboratorIds.filter((id) => id && id !== leadId))];

  if (leadId) {
    await assertActiveTrainer(leadId);
  }
  for (const userId of uniqueCollaborators) {
    await assertActiveTrainer(userId);
  }

  const rows: Array<{ userId: string; role: BatchTrainerRole }> = [];
  if (leadId) {
    rows.push({ userId: leadId, role: BatchTrainerRole.SALES });
  }
  for (const userId of uniqueCollaborators) {
    rows.push({ userId, role: BatchTrainerRole.COLLABORATOR });
  }
  await programBatchRepository.replaceTrainers(batchId, rows);

  const fresh = await programBatchRepository.findById(batchId);
  if (fresh) {
    const programIds = [fresh.programId, ...(fresh.linkedBatches ?? []).map((item) => item.programId)];
    const teamIds = [...new Set(rows.map((row) => row.userId))];
    for (const programId of programIds) {
      const program = await prisma.program.findUnique({
        where: { id: programId },
        select: { createdByUserId: true },
      });
      if (!program) {
        continue;
      }
      for (const userId of teamIds) {
        if (userId === program.createdByUserId) {
          await prisma.programTrainer.upsert({
            where: { programId_userId: { programId, userId } },
            create: { programId, userId, role: "OWNER" },
            update: {},
          });
          continue;
        }
        await prisma.programTrainer.upsert({
          where: { programId_userId: { programId, userId } },
          create: { programId, userId, role: "CO_TRAINER" },
          update: {},
        });
      }
    }
  }
}

async function applyCourseOrder(rootBatchId: string, programIds: string[]) {
  const batch = await programBatchRepository.findById(rootBatchId);
  if (!batch) {
    return;
  }
  const family = [
    { id: batch.id, programId: batch.programId },
    ...(batch.linkedBatches ?? []).map((item) => ({ id: item.id, programId: item.programId })),
  ];
  const byProgram = new Map(family.map((item) => [item.programId, item.id]));
  const uniqueIds = [...new Set(programIds.filter((id) => byProgram.has(id)))];
  await Promise.all(
    uniqueIds.map((programId, index) =>
      prisma.programBatch.update({
        where: { id: byProgram.get(programId)! },
        data: { sortOrder: index },
      }),
    ),
  );
}

async function syncLinkedCourses(
  user: AuthUser,
  batch: NonNullable<Awaited<ReturnType<typeof programBatchRepository.findById>>>,
  programIds: string[],
) {
  const ordered = [...new Set(programIds.filter(Boolean))];
  if (!ordered.includes(batch.programId)) {
    ordered.unshift(batch.programId);
  }
  const desired = ordered.filter((id) => id !== batch.programId);
  for (const programId of desired) {
    await assertBatchableProgram(programId, user);
  }

  const existingByProgram = new Map((batch.linkedBatches ?? []).map((item) => [item.programId, item]));
  const toAdd = desired.filter((id) => !existingByProgram.has(id));
  const toRemove = (batch.linkedBatches ?? []).filter((item) => !desired.includes(item.programId));

  for (const linked of toRemove) {
    const members = await prisma.enrollment.count({
      where: { batchId: linked.id, status: { not: EnrollmentStatus.REMOVED } },
    });
    if (members > 0) {
      throw ApiError.badRequest(
        `${linked.program.title} still has trainees in this batch. Keep it, or remove those trainees first.`,
      );
    }
    await prisma.programBatch.delete({ where: { id: linked.id } });
  }

  const members = await prisma.enrollment.findMany({
    where: { batchId: batch.id, status: { not: EnrollmentStatus.REMOVED } },
    select: { userId: true, joinedAt: true },
  });
  const lead = batch.trainers.find((row) => row.role === BatchTrainerRole.SALES)?.userId ?? batch.createdByUserId;
  const collaborators = batch.trainers
    .filter((row) => row.role !== BatchTrainerRole.SALES)
    .map((row) => row.userId)
    .filter((id) => id !== lead);

  const currentMax = Math.max(
    batch.sortOrder ?? 0,
    ...((batch.linkedBatches ?? []).map((item) => item.sortOrder ?? 0)),
    -1,
  );
  let nextOrder = currentMax + 1;

  for (const programId of toAdd) {
    const linkedName = await uniqueNameForProgram(programId, batch.name);
    const linked = await programBatchRepository.create({
      programId,
      name: linkedName,
      description: batch.description,
      capacity: batch.capacity,
      startDate: batch.startDate,
      endDate: batch.endDate,
      createdByUserId: batch.createdByUserId,
      linkedFromBatchId: batch.id,
      sortOrder: nextOrder,
    });
    nextOrder += 1;
    await applyTrainers(programId, linked.id, {
      salesTrainerId: lead,
      collaboratorIds: collaborators,
    });
    if (members.length > 0) {
      await enrollmentService.enrollTrainees(
        user,
        programId,
        members.map((row) => row.userId),
        linked.id,
      );
    }
  }

  await applyCourseOrder(batch.id, ordered);
}

export const batchService = {
  requireBatchAccess,
  requireBatchManage,
  canManageBatch,
  canEditBatchTeam,
  batchLeadUserId,
  toBatchPayload,

  async listForProgram(user: AuthUser, programId: string) {
    if (isProgramReviewer(user.role)) {
      await programService.requireCanView(user, programId);
    } else {
      await programService.requireTrainerOnProgram(user, programId);
    }
    const batches = await programBatchRepository.listForProgram(programId);
    return {
      batches: batches.map(toBatchPayload),
    };
  },

  async previewCode(input: { startDate?: string; batchNumber?: number; month?: number; year?: number }) {
    const startDate = parseDate(input.startDate);
    const parts = await resolveCodeParts(input, startDate);
    if (!startDate) {
      return { ...parts, targetCompletionDate: null, skipped: null };
    }
    const calendar = await workCalendarService.load();
    const startYmd = ymd(startDate);
    const target = addWorkingDays(startYmd, TRAINING_WORKING_DAYS, calendar);
    const skipped = skippedDays(startYmd, target, calendar);
    const holidayNames = await prisma.holiday.findMany({
      where: { date: { in: skipped.holidays.map((day) => new Date(`${day}T00:00:00Z`)) } },
      select: { date: true, name: true },
      orderBy: { date: "asc" },
    });
    return {
      ...parts,
      targetCompletionDate: target,
      skipped: {
        weeklyOff: skipped.weeklyOff,
        holidays: holidayNames.map((row) => ({ date: row.date.toISOString().slice(0, 10), name: row.name })),
      },
    };
  },

  async catalog(user: AuthUser) {
    if (user.role !== Role.TRAINER && !isProgramReviewer(user.role)) {
      throw ApiError.forbidden();
    }

    const programWhere: Prisma.ProgramWhereInput = isProgramReviewer(user.role)
      ? { status: { in: BATCHABLE_STATUSES } }
      : {
          status: { in: BATCHABLE_STATUSES },
          OR: [{ createdByUserId: user.id }, { trainers: { some: { userId: user.id } } }],
        };

    const [programs, trainers] = await Promise.all([
      prisma.program.findMany({
        where: programWhere,
        select: {
          id: true,
          title: true,
          category: true,
          durationWeeks: true,
          status: true,
          trainingMode: true,
        },
        orderBy: { title: "asc" },
      }),
      prisma.user.findMany({
        where: { role: Role.TRAINER, isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return { programs, trainers };
  },

  async create(user: AuthUser, programId: string, input: BatchInput) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden();
    }
    const orderedProgramIds = [...new Set((input.programIds ?? []).filter(Boolean))];
    if (!orderedProgramIds.includes(programId)) {
      orderedProgramIds.unshift(programId);
    }
    const extraIds = orderedProgramIds.filter((id) => id !== programId);
    await assertBatchableProgram(programId, user);
    for (const extraId of extraIds) {
      await assertBatchableProgram(extraId, user);
    }
    const capacity = input.capacity ?? DEFAULT_BATCH_CAPACITY;
    validateCapacity(capacity);

    const startDate = parseDate(input.startDate);
    const endDate = parseDate(input.endDate);
    const tracked = Boolean(input.lineOfBusiness);
    const explicitBatchNumber = input.batchNumber != null && Number.isInteger(input.batchNumber) && input.batchNumber > 0;
    let codeParts = tracked ? await resolveCodeParts(input, startDate) : null;
    const requestedName = input.name?.trim() || "";
    let name = requestedName || codeParts?.code || "";
    if (!name) {
      throw ApiError.badRequest("A batch name is required.");
    }
    name = await uniqueNameForProgram(programId, name);

    try {
      let created;
      try {
        created = await programBatchRepository.create({
          programId,
          name,
          description: input.description?.trim() ?? "",
          capacity,
          startDate,
          endDate,
          createdByUserId: user.id,
          sortOrder: Math.max(0, orderedProgramIds.indexOf(programId)),
          ...(codeParts
            ? {
                code: codeParts.code,
                month: codeParts.month,
                year: codeParts.year,
                batchNumber: codeParts.batchNumber,
                lineOfBusiness: input.lineOfBusiness,
              }
            : {}),
        });
      } catch (error) {
        // Auto-assigned codes can race; bump once when the caller did not pin a batch number.
        if (tracked && !explicitBatchNumber && isUniqueViolation(error)) {
          const fields = uniqueTargetFields(error);
          if (fields.some((field) => field.includes("code"))) {
            codeParts = await resolveCodeParts({ ...input, batchNumber: undefined }, startDate);
            if (!requestedName) {
              name = await uniqueNameForProgram(programId, codeParts.code);
            }
            created = await programBatchRepository.create({
              programId,
              name,
              description: input.description?.trim() ?? "",
              capacity,
              startDate,
              endDate,
              createdByUserId: user.id,
              sortOrder: Math.max(0, orderedProgramIds.indexOf(programId)),
              code: codeParts.code,
              month: codeParts.month,
              year: codeParts.year,
              batchNumber: codeParts.batchNumber,
              lineOfBusiness: input.lineOfBusiness,
            });
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
      const teamInput: BatchInput = {
        ...input,
        salesTrainerId: user.id,
        collaboratorIds: [...new Set([...(input.collaboratorIds ?? []), ...(input.supportTrainerId ? [input.supportTrainerId] : [])])]
          .filter((id) => id !== user.id),
      };
      await applyTrainers(programId, created.id, teamInput);
      try {
        for (const extraId of extraIds) {
          const linkedName = await uniqueNameForProgram(extraId, name);
          const linked = await programBatchRepository.create({
            programId: extraId,
            name: linkedName,
            description: input.description?.trim() ?? "",
            capacity,
            startDate,
            endDate,
            createdByUserId: user.id,
            linkedFromBatchId: created.id,
            sortOrder: Math.max(0, orderedProgramIds.indexOf(extraId)),
          });
          await applyTrainers(extraId, linked.id, teamInput);
        }
      } catch (linkedError) {
        await prisma.programBatch.delete({ where: { id: created.id } });
        throw linkedError;
      }
      const saved = await programBatchRepository.findById(created.id);
      return { batch: toBatchPayload(saved ?? { ...created, _count: { enrollments: 0 } }) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throwBatchUniqueConflict(error);
      }
      throw error;
    }
  },

  async update(user: AuthUser, batchId: string, input: BatchInput) {
    if (user.role !== Role.TRAINER && !isProgramReviewer(user.role)) {
      throw ApiError.forbidden();
    }
    const batch = await requireBatchAccess(user, batchId);
    if (!canManageBatch(user, batch)) {
      throw ApiError.forbidden("Only this batch's trainers can edit it.");
    }
    const touchingTeam =
      "salesTrainerId" in input || "supportTrainerId" in input || "collaboratorIds" in input;
    if (touchingTeam && !canEditBatchTeam(user, batch)) {
      throw ApiError.forbidden("Only the lead trainer can add or remove co-trainers.");
    }
    if (input.capacity !== undefined) {
      validateCapacity(input.capacity);
      const members = await programBatchRepository.countMembers(batch.id);
      if (input.capacity < members) {
        throw ApiError.badRequest("Capacity cannot be lower than the number of enrolled trainees.");
      }
    }

    const lineOfBusiness = "lineOfBusiness" in input ? input.lineOfBusiness ?? null : batch.lineOfBusiness;
    const codeChanged =
      input.month !== undefined ||
      input.year !== undefined ||
      input.batchNumber !== undefined ||
      ("lineOfBusiness" in input && Boolean(input.lineOfBusiness) && !batch.code);
    let codeFields = {};
    if (lineOfBusiness && codeChanged) {
      const startDate = "startDate" in input ? parseDate(input.startDate) : batch.startDate;
      const parts = await resolveCodeParts(
        {
          month: input.month ?? batch.month,
          year: input.year ?? batch.year,
          batchNumber: input.batchNumber ?? batch.batchNumber,
        },
        startDate,
      );
      codeFields = { code: parts.code, month: parts.month, year: parts.year, batchNumber: parts.batchNumber };
    }

    try {
      await programBatchRepository.update(batch.id, {
        ...(input.name !== undefined && input.name.trim() ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...("startDate" in input ? { startDate: parseDate(input.startDate) } : {}),
        ...("endDate" in input ? { endDate: parseDate(input.endDate) } : {}),
        ...("lineOfBusiness" in input ? { lineOfBusiness } : {}),
        ...("actualCompletionDate" in input ? { actualCompletionDate: parseDate(input.actualCompletionDate) } : {}),
        ...codeFields,
      });
      await applyTrainers(batch.programId, batch.id, input);
      if (touchingTeam) {
        for (const linked of batch.linkedBatches ?? []) {
          await applyTrainers(linked.programId, linked.id, input);
        }
      }
      if ("programIds" in input && input.programIds) {
        await syncLinkedCourses(user, batch, input.programIds);
      }
      const saved = await programBatchRepository.findById(batch.id);
      return { batch: toBatchPayload(saved ?? batch) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throwBatchUniqueConflict(error);
      }
      throw error;
    }
  },

  async remove(user: AuthUser, batchId: string) {
    if (user.role !== Role.TRAINER) {
      throw ApiError.forbidden();
    }
    const batch = await requireBatchAccess(user, batchId);
    const familyIds = [batch.id, ...(batch.linkedBatches ?? []).map((item) => item.id)];
    const members = await prisma.enrollment.count({
      where: { batchId: { in: familyIds }, status: { not: EnrollmentStatus.REMOVED } },
    });
    if (members > 0) {
      throw ApiError.conflict("Cannot delete a batch that has enrollments.");
    }
    await prisma.$transaction([
      prisma.enrollment.deleteMany({ where: { batchId: { in: familyIds }, status: EnrollmentStatus.REMOVED } }),
      prisma.programBatch.deleteMany({ where: { linkedFromBatchId: batch.id } }),
      prisma.programBatch.delete({ where: { id: batch.id } }),
    ]);
    return { deleted: true };
  },

  async listTrainees(user: AuthUser, batchId: string) {
    const batch = await requireBatchAccess(user, batchId);
    const roster = await enrollmentService.buildRoster(batch.programId, batch.id);
    return {
      batch: toBatchPayload(batch),
      ...roster,
    };
  },

  async enroll(user: AuthUser, batchId: string, traineeIds: string[], joinedAt?: Date) {
    const requested = await requireBatchManage(user, batchId);
    const root = requested.linkedFromBatchId
      ? await requireBatchManage(user, requested.linkedFromBatchId)
      : requested;
    const result = await enrollmentService.enrollTrainees(user, root.programId, traineeIds, root.id, joinedAt);
    for (const linked of root.linkedBatches ?? []) {
      await enrollmentService.enrollTrainees(user, linked.programId, traineeIds, linked.id, joinedAt);
    }
    return result;
  },
};
