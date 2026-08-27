import { prisma } from "../config/prisma";
import { programService } from "./program.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { isUuid } from "../validators/common";

function optionalId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!isUuid(value)) {
    throw ApiError.badRequest(`Invalid ${label}`);
  }
  return value;
}

export async function resolveTrainerWorkScope(
  user: AuthUser,
  programIdRaw?: unknown,
  batchIdRaw?: unknown,
): Promise<{ programIds: string[]; programId?: string; batchId?: string }> {
  const programIds = await programService.listProgramIdsForTrainer(user.id);
  const programId = optionalId(programIdRaw, "programId");
  const batchId = optionalId(batchIdRaw, "batchId");

  if (programId && !programIds.includes(programId)) {
    throw ApiError.forbidden();
  }

  if (!batchId) {
    return { programIds: programId ? [programId] : programIds, programId };
  }

  const batch = await prisma.programBatch.findUnique({
    where: { id: batchId },
    select: { id: true, programId: true },
  });
  if (!batch || !programIds.includes(batch.programId)) {
    throw ApiError.forbidden();
  }
  if (programId && batch.programId !== programId) {
    throw ApiError.badRequest("Batch does not belong to that course");
  }

  return { programIds: [batch.programId], programId: batch.programId, batchId: batch.id };
}
