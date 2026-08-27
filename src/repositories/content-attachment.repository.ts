import { prisma } from "../config/prisma";

const attachmentScope = {
  lesson: { include: { day: { include: { week: { include: { program: true } } } } } },
  assignment: { include: { day: { include: { week: { include: { program: true } } } } } },
} as const;

export const contentAttachmentRepository = {
  findById(id: string) {
    return prisma.contentAttachment.findUnique({
      where: { id },
      include: attachmentScope,
    });
  },

  findByKey(fileKey: string) {
    return prisma.contentAttachment.findUnique({ where: { fileKey } });
  },

  listForLesson(lessonId: string) {
    return prisma.contentAttachment.findMany({
      where: { lessonId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },

  listForAssignment(assignmentId: string) {
    return prisma.contentAttachment.findMany({
      where: { assignmentId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },

  async nextSortOrder(where: { lessonId?: string; assignmentId?: string }) {
    const result = await prisma.contentAttachment.aggregate({
      where,
      _max: { sortOrder: true },
    });
    return (result._max.sortOrder ?? -1) + 1;
  },

  create(input: {
    lessonId?: string | null;
    assignmentId?: string | null;
    sortOrder: number;
    title: string;
    fileName: string;
    fileKey: string;
    mimeType: string;
    fileSize: number;
    storageProvider: string;
    uploadedByUserId: string | null;
  }) {
    return prisma.contentAttachment.create({ data: input });
  },

  delete(id: string) {
    return prisma.contentAttachment.delete({ where: { id } });
  },

  countByKey(fileKey: string) {
    return prisma.contentAttachment.count({ where: { fileKey } });
  },
};
