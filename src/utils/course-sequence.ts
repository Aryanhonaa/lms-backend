const SEQUENCE_WORDS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
];

export function sequenceLabel(index: number): string {
  return SEQUENCE_WORDS[index] ?? `Course ${index + 1}`;
}

export type BatchCourseMember = {
  id: string;
  title: string;
  batchId: string;
  sortOrder: number;
  sequence: number;
  label: string;
  isPrimary: boolean;
};

type FamilyMember = {
  batchId: string;
  programId: string;
  title: string;
  sortOrder: number;
  createdAt: Date;
  isPrimary: boolean;
};

export function orderedBatchCourses(input: {
  id: string;
  programId: string;
  sortOrder?: number | null;
  createdAt: Date;
  program?: { id: string; title: string } | null;
  linkedBatches?: Array<{
    id: string;
    programId: string;
    sortOrder?: number | null;
    createdAt?: Date;
    program: { id: string; title: string };
  }>;
}): BatchCourseMember[] {
  const members: FamilyMember[] = [
    {
      batchId: input.id,
      programId: input.programId,
      title: input.program?.title ?? "",
      sortOrder: input.sortOrder ?? 0,
      createdAt: input.createdAt,
      isPrimary: true,
    },
  ];
  for (const linked of input.linkedBatches ?? []) {
    if (linked.programId === input.programId) {
      continue;
    }
    members.push({
      batchId: linked.id,
      programId: linked.programId,
      title: linked.program.title,
      sortOrder: linked.sortOrder ?? 0,
      createdAt: linked.createdAt ?? input.createdAt,
      isPrimary: false,
    });
  }
  members.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
  return members.map((item, index) => ({
    id: item.programId,
    title: item.title,
    batchId: item.batchId,
    sortOrder: item.sortOrder,
    sequence: index + 1,
    label: sequenceLabel(index),
    isPrimary: item.isPrimary,
  }));
}
