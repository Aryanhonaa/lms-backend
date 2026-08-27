import { ContentItemType } from "../generated/prisma";
import { contentCompletionRepository } from "../repositories/content-completion.repository";
import { curriculumRepository } from "../repositories/curriculum.repository";
import { progressService, type PublicLearnItem } from "./progress.service";
import type { LearnableItemType } from "./unlock.service";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";

const ITEM_TYPES = new Set<string>(Object.values(ContentItemType));

function parseItemType(value: string): ContentItemType {
  const normalized = value.trim().toUpperCase();
  if (!ITEM_TYPES.has(normalized)) {
    throw ApiError.badRequest("Invalid content type");
  }
  return normalized as ContentItemType;
}

async function resolveItemProgram(itemType: ContentItemType, itemId: string) {
  const loaders = {
    LESSON: () => curriculumRepository.lesson(itemId),
    VIDEO: () => curriculumRepository.video(itemId),
    RESOURCE: () => curriculumRepository.resource(itemId),
    REEL: () => curriculumRepository.reel(itemId),
  } as const;

  const record = await loaders[itemType]();
  if (!record) {
    throw ApiError.notFound("Content not found");
  }

  return record.day.week.programId;
}

function findPublicItem(
  view: Awaited<ReturnType<typeof progressService.getLearnView>>,
  itemType: LearnableItemType,
  itemId: string,
): PublicLearnItem | null {
  for (const week of view.weeks) {
    for (const day of week.days) {
      const match = day.items.find((item) => item.type === itemType && item.id === itemId);
      if (match) {
        return match;
      }
    }
  }
  return null;
}

export const learningService = {
  listEnrollments(userId: string) {
    return progressService.listSummaries(userId);
  },

  getLearnView(user: AuthUser, programId: string, batchId?: string) {
    return progressService.getLearnView(user, programId, batchId);
  },

  async getItem(user: AuthUser, itemTypeParam: string, itemId: string, batchId?: string) {
    const itemType = parseItemType(itemTypeParam);
    const programId = await resolveItemProgram(itemType, itemId);
    const view = await progressService.getLearnView(user, programId, batchId);
    const item = findPublicItem(view, itemType as LearnableItemType, itemId);

    if (!item) {
      throw ApiError.notFound("Content not found");
    }

    return { item, programId, nextActivity: view.nextActivity, progress: view.progress };
  },

  async completeItem(user: AuthUser, itemTypeParam: string, itemId: string, batchId?: string) {
    const itemType = parseItemType(itemTypeParam);
    const programId = await resolveItemProgram(itemType, itemId);
    const view = await progressService.getLearnView(user, programId, batchId);
    const item = findPublicItem(view, itemType as LearnableItemType, itemId);

    if (!item) {
      throw ApiError.notFound("Content not found");
    }

    if (item.status === "LOCKED") {
      throw new ApiError(403, item.reason ?? "This content is locked", "CONTENT_LOCKED");
    }

    const { enrollment } = await progressService.requireEnrollment(user.id, programId, batchId);
    await contentCompletionRepository.upsert(enrollment.id, itemType, itemId);
    return progressService.getLearnView(user, programId, batchId);
  },
};

export type { PublicLearnItem };
export type AccessStatus = PublicLearnItem["status"];
export type { LearnableItemType };
