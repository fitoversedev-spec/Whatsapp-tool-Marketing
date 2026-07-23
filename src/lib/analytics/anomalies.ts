// Phase 3 (analytics v2) — Anomalies group (A4): a deterministic rule
// engine, not an ML/statistical one. Not surfaced in any UI this phase —
// Phase 5's insight feed (insights.ts, A11) imports these rules as one
// category of insight card. The "discount-leakage-by-region" rule (quoted-
// vs-won-value gap %) is deliberately NOT built here — the plan drops it as
// too close to the excluded ₹/sqft-pricing concept.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import { companyBenchmarks } from "./benchmarks";
import { salesActivity } from "./salesActivity";

export type Anomaly = { rule: string; severity: "info" | "warning"; subject: string; detail: string; n: number };

// Every rule below compares the selected window against the immediately
// preceding, equal-length, non-overlapping window — same period-math as
// quadrants.ts's productQuadrant, factored out once here since all 4 rules
// need it instead of each rule re-deriving its own prevFrom/prevTo.
function precedingPeriod(filter: AnalyticsFilter): { from: Date; to: Date } {
  const windowMs = filter.to.getTime() - filter.from.getTime();
  const to = new Date(filter.from.getTime() - 1);
  const from = new Date(to.getTime() - windowMs);
  return { from, to };
}

// Each rule below picks its own "meaningful" threshold and its own "at least
// double the threshold escalates to warning" cutoff for severity — visible
// defaults, not confirmed business thresholds, same status as products.ts's
// LOW_CONVERSION_THRESHOLD.
const ENQUIRY_UP_THRESHOLD = 0.2; // +20% enquiry volume vs preceding period
const WIN_RATE_DECAY_THRESHOLD = 0.15; // -15 percentage points, absolute
const CYCLE_TIME_SPIKE_THRESHOLD = 0.2; // +20% avg cycle days vs preceding period
const ACTIVITY_UP_THRESHOLD = 0.2; // +20% activity score vs preceding period
const CONVERSION_DOWN_THRESHOLD = 0.1; // -10 percentage points win rate, absolute

function severity(deviation: number, threshold: number): "info" | "warning" {
  return deviation >= threshold * 2 ? "warning" : "info";
}

export async function enquiriesUpWinsFlat(filter: AnalyticsFilter): Promise<Anomaly[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};
  const prev = precedingPeriod(filter);

  const [currentEnquiries, previousEnquiries, currentWon, previousWon] = await Promise.all([
    prisma.deal.count({ where: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere } }),
    prisma.deal.count({ where: { deletedAt: null, createdAt: { gte: prev.from, lte: prev.to }, ...ownerWhere, ...dealChannelWhere } }),
    prisma.deal.count({ where: { deletedAt: null, outcome: "WON", closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere } }),
    prisma.deal.count({ where: { deletedAt: null, outcome: "WON", closedAt: { gte: prev.from, lte: prev.to }, ...ownerWhere, ...dealChannelWhere } }),
  ]);

  // Not explicitly required by the rule spec, but the enquiry "% change" is
  // itself a rate — gated the same way any other rate/median in this codebase
  // is (MIN_SAMPLE_SIZE), so "2 enquiries became 3" doesn't read as a 50% spike.
  if (previousEnquiries < MIN_SAMPLE_SIZE) return [];

  const enquiryChange = (currentEnquiries - previousEnquiries) / previousEnquiries;
  if (enquiryChange < ENQUIRY_UP_THRESHOLD) return [];
  if (currentWon > previousWon) return []; // wins moved with enquiries — not the "flat or down" pattern this rule looks for

  return [
    {
      rule: "enquiriesUpWinsFlat",
      severity: severity(enquiryChange, ENQUIRY_UP_THRESHOLD),
      subject: "Company-wide",
      detail: `Enquiries up ${(enquiryChange * 100).toFixed(0)}% (${previousEnquiries} -> ${currentEnquiries}) vs the preceding period while won deals stayed flat or fell (${previousWon} -> ${currentWon})`,
      n: currentEnquiries,
    },
  ];
}

export async function sourceWinRateDecay(filter: AnalyticsFilter): Promise<Anomaly[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};
  const prev = precedingPeriod(filter);

  const [sourceTaxonomy, currentClosed, previousClosed] = await Promise.all([
    prisma.leadSource.findMany({ select: { id: true, name: true } }),
    prisma.deal.findMany({
      where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { leadSourceId: true, outcome: true },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: prev.from, lte: prev.to }, ...ownerWhere, ...dealChannelWhere },
      select: { leadSourceId: true, outcome: true },
    }),
  ]);

  // Same source-name resolution as leadSourceQuadrant/sourceComparison.
  const nameById = new Map(sourceTaxonomy.map((s) => [s.id, s.name]));
  const nameFor = (id: string | null) => (id ? nameById.get(id) ?? "(unknown source)" : "(unspecified)");

  function tally(rows: { leadSourceId: string | null; outcome: string | null }[]): Map<string, { won: number; closed: number }> {
    const map = new Map<string, { won: number; closed: number }>();
    for (const d of rows) {
      const name = nameFor(d.leadSourceId);
      const e = map.get(name) ?? { won: 0, closed: 0 };
      e.closed += 1;
      if (d.outcome === "WON") e.won += 1;
      map.set(name, e);
    }
    return map;
  }

  const currentMap = tally(currentClosed);
  const previousMap = tally(previousClosed);

  const anomalies: Anomaly[] = [];
  for (const [name, cur] of currentMap) {
    const prevEntry = previousMap.get(name);
    // A source with no closed deals last period has nothing to "decay" from.
    if (!prevEntry) continue;
    if (cur.closed < MIN_SAMPLE_SIZE || prevEntry.closed < MIN_SAMPLE_SIZE) continue;

    const curRate = cur.won / cur.closed;
    const prevRate = prevEntry.won / prevEntry.closed;
    const drop = prevRate - curRate;
    if (drop < WIN_RATE_DECAY_THRESHOLD) continue;

    anomalies.push({
      rule: "sourceWinRateDecay",
      severity: severity(drop, WIN_RATE_DECAY_THRESHOLD),
      subject: name,
      detail: `Win rate down ${(drop * 100).toFixed(0)}pp (${(prevRate * 100).toFixed(0)}% -> ${(curRate * 100).toFixed(0)}%) vs the preceding period`,
      n: cur.closed,
    });
  }
  return anomalies.sort((a, b) => b.n - a.n);
}

export async function cycleTimeSpike(filter: AnalyticsFilter): Promise<Anomaly[]> {
  const prev = precedingPeriod(filter);
  // companyBenchmarks forces company-wide scope (ownerIds cleared,
  // dealChannel:"crm") and its own MIN_SAMPLE_SIZE gate internally — reused
  // as-is rather than re-deriving the cycle-day computation. It doesn't
  // expose the raw closed-deal count behind avgCycleDays, so that's counted
  // separately here (same company-wide scope) purely to populate `n`.
  const [current, previous, currentClosedCount] = await Promise.all([
    companyBenchmarks(filter),
    companyBenchmarks({ ...filter, from: prev.from, to: prev.to }),
    prisma.deal.count({
      where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, dealChannel: "crm" },
    }),
  ]);

  if (current.avgCycleDays == null || previous.avgCycleDays == null || previous.avgCycleDays === 0) return [];

  const change = (current.avgCycleDays - previous.avgCycleDays) / previous.avgCycleDays;
  if (change < CYCLE_TIME_SPIKE_THRESHOLD) return [];

  return [
    {
      rule: "cycleTimeSpike",
      severity: severity(change, CYCLE_TIME_SPIKE_THRESHOLD),
      subject: "Company-wide",
      detail: `Avg cycle time up ${(change * 100).toFixed(0)}% (${previous.avgCycleDays.toFixed(1)}d -> ${current.avgCycleDays.toFixed(1)}d) vs the preceding period`,
      n: currentClosedCount,
    },
  ];
}

export async function repActivityUpConversionDown(filter: AnalyticsFilter): Promise<Anomaly[]> {
  const prev = precedingPeriod(filter);
  const [current, previous] = await Promise.all([
    salesActivity(filter),
    salesActivity({ ...filter, from: prev.from, to: prev.to }),
  ]);

  const previousByOwner = new Map(previous.map((r) => [r.ownerId, r]));

  const anomalies: Anomaly[] = [];
  for (const cur of current) {
    const prevRow = previousByOwner.get(cur.ownerId);
    if (!prevRow) continue;
    if (cur.dealsClosed < MIN_SAMPLE_SIZE || prevRow.dealsClosed < MIN_SAMPLE_SIZE) continue;
    if (cur.winRate == null || prevRow.winRate == null) continue;

    // Same 3-metric activity score as quadrants.ts's repQuadrant.
    const curActivity = cur.dealsCreated + cur.siteVisits + cur.samplesSent;
    const prevActivity = prevRow.dealsCreated + prevRow.siteVisits + prevRow.samplesSent;
    if (prevActivity === 0) continue; // no baseline to call "up" meaningful against

    const activityChange = (curActivity - prevActivity) / prevActivity;
    const winRateDrop = prevRow.winRate - cur.winRate;
    if (activityChange < ACTIVITY_UP_THRESHOLD || winRateDrop < CONVERSION_DOWN_THRESHOLD) continue;

    anomalies.push({
      rule: "repActivityUpConversionDown",
      severity: severity(winRateDrop, CONVERSION_DOWN_THRESHOLD),
      subject: cur.ownerName,
      detail: `Activity up ${(activityChange * 100).toFixed(0)}% (${prevActivity} -> ${curActivity}) while win rate fell ${(winRateDrop * 100).toFixed(0)}pp (${(prevRow.winRate * 100).toFixed(0)}% -> ${(cur.winRate * 100).toFixed(0)}%)`,
      n: cur.dealsClosed,
    });
  }
  return anomalies.sort((a, b) => b.n - a.n);
}
