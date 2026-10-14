/**
 * Pure shaping for the analytics tool: whatever the shared analytics functions
 * return, the agent gets company-wide totals only. Anything per rep (names,
 * rankings, rep breakdowns) and anything that is internal cost (ad spend, CAC,
 * ROAS, cost per lead) is removed here, at any depth, whatever the source adds
 * later. Nothing in this file touches the database.
 */

const INTERNAL_KEYS = new Set([
  // per-rep / HR performance
  "reps",
  "repRankings",
  "repQuadrantSelf",
  "repName",
  "repId",
  "byRep",
  "ownerId",
  "ownerName",
  "ownerUserId",
  // internal cost
  "adSpend",
  "costPerLead",
  "cac",
  "roas",
  "totalCostInr",
]);

export function stripInternalKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInternalKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (INTERNAL_KEYS.has(k)) continue;
      out[k] = stripInternalKeys(v);
    }
    return out;
  }
  return value;
}

type KpiBoardLike = {
  wonRevenue: number;
  winRate: { rate: number | null; n: number };
  avgProjectValue: number | null;
  salesVelocity: number | null;
  dealsCreated: number;
  benchmarks?: unknown;
  targetProgress?: { openPipelineValue?: number; weightedPipelineValue?: number | null; wonDeals?: number } | null;
};

/**
 * Headline numbers only. The revenue targets and pace set by management, and
 * the per-rep ranking, are not part of what the agent may see.
 */
export function shapeKpiBoard(k: KpiBoardLike) {
  return stripInternalKeys({
    wonRevenue: k.wonRevenue,
    wonDeals: k.targetProgress?.wonDeals ?? null,
    winRate: k.winRate,
    avgProjectValue: k.avgProjectValue,
    salesVelocity: k.salesVelocity,
    dealsCreated: k.dealsCreated,
    openPipelineValue: k.targetProgress?.openPipelineValue ?? null,
    weightedPipelineValue: k.targetProgress?.weightedPipelineValue ?? null,
    companyBenchmarks: k.benchmarks ?? null,
  });
}

export type OpenDealSource = {
  dealId: string;
  dealCode: string;
  dealValue: number;
  customerName: string;
  stageName: string;
  interestedProducts: string[];
  nextActivity: { message: string; dueAt: string } | null;
  // present on the source rows; deliberately not copied
  ownerId?: string;
  ownerName?: string;
  latestNote?: unknown;
  quotations?: unknown;
  courtImages?: unknown;
};

export function toOpenDealRow(r: OpenDealSource) {
  return {
    dealId: r.dealId,
    dealCode: r.dealCode,
    customerName: r.customerName,
    stage: r.stageName,
    valueInr: r.dealValue,
    interestedProducts: r.interestedProducts,
    nextActivity: r.nextActivity,
  };
}
