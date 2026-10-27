// The website-lead numbers that come from our own database (not Google): leads
// per day and in total for the overview, and leads by where they came from.
// "Live" leads only: ingest saves nothing but live-site leads, and the same
// where-clause as the Website Leads table hides the deleted ones.
import { prisma } from "@/lib/prisma";
import { buildWebsiteLeadWhere } from "@/lib/website-leads/list";
import { istDateOf, istDayEnd, istDayStart } from "./range";
import { SOURCE_GROUPS, type SourceGroup } from "./sources";
import type { LeadsBySourceData, OverviewData, ResolvedRange } from "./types";

const whereFor = (from: string, to: string) => buildWebsiteLeadWhere({ from: istDayStart(from), to: istDayEnd(to) });

// Plenty for a year and a half of enquiries; keeps the day-bucketing read bounded.
const MAX_LEADS_READ = 50_000;

/** Leads per IST day in the range, the range total and the previous period's total. */
export async function leadCounts(
  r: ResolvedRange,
): Promise<{ perDay: Map<string, number>; total: number; previous: number }> {
  const [times, previous] = await Promise.all([
    prisma.websiteLead.findMany({ where: whereFor(r.from, r.to), select: { receivedAt: true }, take: MAX_LEADS_READ }),
    prisma.websiteLead.count({ where: whereFor(r.prevFrom, r.prevTo) }),
  ]);
  const perDay = new Map<string, number>();
  for (const { receivedAt } of times) {
    const day = istDateOf(receivedAt);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return { perDay, total: times.length, previous };
}

/** Lead rate = leads / visitors; null when nobody visited. */
export const leadRate = (leads: number, visitors: number): number | null =>
  visitors > 0 ? Math.round((leads / visitors) * 10_000) / 10_000 : null;

export function overviewLeads(
  counts: { total: number; previous: number },
  visitors: OverviewData["visitors"],
): OverviewData["leads"] {
  return {
    total: counts.total,
    previous: counts.previous,
    rate: leadRate(counts.total, visitors.value),
    previousRate: leadRate(counts.previous, visitors.previous),
  };
}

export async function leadsBySource(r: ResolvedRange): Promise<LeadsBySourceData> {
  const groups = await prisma.websiteLead.groupBy({
    by: ["cameFrom", "cameFromGroup"],
    where: whereFor(r.from, r.to),
    _count: { _all: true },
  });
  const known = new Set<string>(SOURCE_GROUPS);
  const byLabel = new Map<string, { label: string; group: SourceGroup; count: number }>();
  const byGroup = new Map<SourceGroup, number>();
  let total = 0;
  for (const g of groups) {
    const label = g.cameFrom ?? "Unknown";
    const group = (g.cameFromGroup && known.has(g.cameFromGroup) ? g.cameFromGroup : "Unknown") as SourceGroup;
    const count = g._count._all;
    total += count;
    const cur = byLabel.get(label);
    if (cur) cur.count += count;
    else byLabel.set(label, { label, group, count });
    byGroup.set(group, (byGroup.get(group) ?? 0) + count);
  }
  return {
    total,
    sources: [...byLabel.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    groups: [...byGroup.entries()]
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => b.count - a.count || SOURCE_GROUPS.indexOf(a.group) - SOURCE_GROUPS.indexOf(b.group)),
  };
}
