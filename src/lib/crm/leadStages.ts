// The contact/lead sales stages (LeadStage). Ordered by sortOrder; removed
// stages (deletedAt) are gone everywhere, inactive ones stay readable on the
// contacts already in them but can't be picked any more.
import { prisma } from "@/lib/prisma";

export type LeadStageOption = { id: string; name: string; colorHex: string | null; isActive: boolean };

export async function listLeadStages(): Promise<LeadStageOption[]> {
  return prisma.leadStage.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, colorHex: true, isActive: true },
  });
}

// Where a contact lands when moved into Leads without a stage of its own.
export async function firstLeadStage(): Promise<{ id: string; name: string } | null> {
  return prisma.leadStage.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
}
