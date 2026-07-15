// Deal code generation — mirrors buildQuotationNumber/nextSequenceForYear in
// src/app/api/quotations/route.ts exactly (max-existing-seq + 1, not
// count()+1, so a deleted row never causes a collision; retry-on-P2002 at
// the call site handles the genuine-race case).
import { prisma } from "@/lib/prisma";

export function buildDealCode(year: number, existingThisYear: number): string {
  const seq = String(existingThisYear + 1).padStart(3, "0");
  return `FIT-DL-${year}-${seq}`;
}

export async function nextDealSequenceForYear(year: number): Promise<number> {
  const prefix = `FIT-DL-${year}-`;
  const latest = await prisma.deal.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  if (!latest) return 1;
  const seqStr = latest.code.slice(prefix.length);
  const seq = parseInt(seqStr, 10);
  if (!Number.isFinite(seq)) return 1;
  return seq + 1;
}

// The stage a brand-new Deal starts in — lowest sortOrder among active
// (non-won/lost) stages. Throws if none exist (shouldn't happen once
// scripts/seed-taxonomies.ts has run).
export async function defaultFunnelStageId(): Promise<string> {
  const stage = await prisma.funnelStage.findFirst({
    where: { isActive: true, stageType: "active" },
    orderBy: { sortOrder: "asc" },
  });
  if (!stage) throw new Error("No active FunnelStage rows — run scripts/seed-taxonomies.ts");
  return stage.id;
}
