import "server-only";

import { Prisma, prisma } from "@/lib/scout/db";
import { canAccessAllScans, type ScoutIdentity } from "@/lib/scout/identity";
import { getScanResult } from "@/lib/scout/places/scanResult";
import { resolveCategories } from "@/lib/scout/places/taxonomy";
import type { ScoreResult } from "@/lib/scout/scoring/types";
import { saturationFigures } from "@/lib/scout/display/saturation";
import type { CompareSubject } from "@/lib/scout/compare/model";

/**
 * The read side of the desktop screens.
 *
 * Ownership follows Phase 1 throughout: a salesperson sees their own scans, an
 * admin sees any. Nothing here widens that — the dashboard is "saved scans",
 * not "everyone's scans", unless you are an admin.
 */

export interface DashboardScan {
  readonly id: string;
  readonly areaLabel: string;
  readonly radiusM: number;
  readonly status: "draft" | "scanned" | "report_sent";
  readonly customerName: string | null;
  readonly ownerName: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly facilityCount: number | null;
  readonly demandCount: number | null;
  readonly avgRating: number | null;
  readonly scoreTotal: number | null;
  readonly scoreVerdict: "proceed" | "investigate" | "avoid" | null;
  readonly scoreBasis: "full" | "desk_only" | null;
  readonly scoreConfidence: "high" | "medium" | "low" | null;
  /** True when any search in this scan may have been truncated. */
  readonly saturated: boolean;
  readonly jobStatus: string | null;
  readonly completedTasks: number | null;
  readonly totalTasks: number | null;
}

function ownershipFilter(identity: ScoutIdentity): Prisma.ScanWhereInput {
  // An admin sees the desk; a salesperson sees their own work.
  return canAccessAllScans(identity) ? {} : { ownerId: identity.userId };
}

export async function listDashboardScans(identity: ScoutIdentity): Promise<DashboardScan[]> {
  const rows = await prisma.scan.findMany({
    where: ownershipFilter(identity),
    select: {
      id: true,
      areaLabel: true,
      radiusM: true,
      status: true,
      customerName: true,
      ownerId: true,
      createdAt: true,
      facilityCount: true,
      demandCount: true,
      avgRating: true,
      scoreTotal: true,
      scoreVerdict: true,
      scoreBasis: true,
      scoreConfidence: true,
      saturation: true,
      // Was an INNER JOIN on `users`; `owner_id` is NOT NULL with a foreign key,
      // so the relation is always present.
      owner: { select: { name: true } },
      // Was a LEFT JOIN on `scan_jobs`: a draft scan has no job.
      job: { select: { status: true, completedTasks: true, totalTasks: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  return rows.map((row) => ({
    id: row.id,
    areaLabel: row.areaLabel,
    radiusM: row.radiusM,
    status: row.status,
    customerName: row.customerName,
    ownerId: row.ownerId,
    ownerName: row.owner.name,
    createdAt: row.createdAt.toISOString(),
    facilityCount: row.facilityCount,
    demandCount: row.demandCount,
    avgRating: row.avgRating,
    // `numeric` is a `Decimal` under Prisma where it was a string under
    // Drizzle. `Number()` reads both; `Number(null)` would be 0, hence the guard.
    scoreTotal: row.scoreTotal === null ? null : Number(row.scoreTotal),
    scoreVerdict: (row.scoreVerdict as DashboardScan["scoreVerdict"]) ?? null,
    scoreBasis: (row.scoreBasis as DashboardScan["scoreBasis"]) ?? null,
    scoreConfidence: (row.scoreConfidence as DashboardScan["scoreConfidence"]) ?? null,
    saturated: (row.saturation as { anySaturated?: boolean } | null)?.anySaturated === true,
    jobStatus: row.job?.status ?? null,
    completedTasks: row.job?.completedTasks ?? null,
    totalTasks: row.job?.totalTasks ?? null,
  }));
}

export interface RecentReport {
  readonly id: string;
  readonly scanId: string;
  readonly title: string;
  readonly areaLabel: string;
  readonly status: string;
  readonly channel: "whatsapp" | "pdf" | "email" | null;
  readonly sentTo: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

export async function listRecentReports(identity: ScoutIdentity): Promise<RecentReport[]> {
  const rows = await prisma.report.findMany({
    where: canAccessAllScans(identity) ? {} : { createdBy: identity.userId },
    select: {
      id: true,
      scanId: true,
      title: true,
      status: true,
      channel: true,
      sentTo: true,
      sentAt: true,
      createdAt: true,
      scan: { select: { areaLabel: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return rows.map((r) => ({
    id: r.id,
    scanId: r.scanId,
    title: r.title ?? `${r.scan.areaLabel} — Site Scout`,
    areaLabel: r.scan.areaLabel,
    status: r.status,
    channel: r.channel,
    sentTo: r.sentTo,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** A scan the caller may read, or `null`. Used by every `[id]` screen. */
export async function readableScanIds(
  identity: ScoutIdentity,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.scan.findMany({
    where: { id: { in: [...ids] }, ...ownershipFilter(identity) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------- comparison */

/**
 * Assemble the comparison subjects.
 *
 * The counts come from `getScanResult` rather than the cached columns on
 * `scans`, because the comparison prints per-category counts and the saturation
 * flags that qualify them — and a count printed without its "at least" is the
 * defect this whole pipeline exists to avoid.
 */
export async function getCompareSubjects(
  identity: ScoutIdentity,
  scanIds: readonly string[],
): Promise<CompareSubject[]> {
  const allowed = await readableScanIds(identity, scanIds);
  if (allowed.length === 0) return [];

  const meta = await prisma.scan.findMany({
    where: { id: { in: allowed } },
    select: {
      id: true,
      searchTerms: true,
      scoreTotal: true,
      scoreVerdict: true,
      scoreBasis: true,
      scoreConfidence: true,
      scoreBreakdown: true,
    },
  });

  const metaById = new Map(meta.map((m) => [m.id, m]));

  // Preserve the order the caller asked for — the columns are theirs to arrange.
  const ordered = scanIds.filter((id) => allowed.includes(id));
  const subjects: CompareSubject[] = [];

  for (const id of ordered) {
    const result = await getScanResult(id);
    const m = metaById.get(id);
    if (!result || !m) continue;

    const categoryIds = readCategoryIds(m.searchTerms as Record<string, unknown> | null);
    const score =
      m.scoreTotal === null || m.scoreVerdict === null
        ? null
        : {
            total: Number(m.scoreTotal),
            verdict: m.scoreVerdict as "proceed" | "investigate" | "avoid",
            basis: (m.scoreBasis as "full" | "desk_only") ?? "desk_only",
            confidence: (m.scoreConfidence as "high" | "medium" | "low") ?? "low",
          };

    const breakdown = m.scoreBreakdown as unknown as ScoreResult | null;
    const figures = breakdown ? saturationFigures(breakdown) : null;

    subjects.push({
      scanId: id,
      areaLabel: result.areaLabel,
      radiusM: result.radiusM,
      categoryIds,
      facilityCount: result.competitionCount,
      demandCount: result.demandCount,
      reviewTotal: result.reviewTotal,
      avgRating: result.avgRating,
      categoryCounts: result.categoryCounts,
      saturatedCategoryIds: result.categories.filter((c) => c.saturated).map((c) => c.categoryId),
      anySaturated: result.saturation.anySaturated,
      score,
      anchorsPerFacility: figures?.anchorsPerFacility ?? null,
      weightedAnchorTotal: figures?.weightedAnchorTotal ?? null,
      benchmarkAnchorsPerFacility: figures?.benchmarkIsModelDefault
        ? null
        : (figures?.benchmarkAnchorsPerFacility ?? null),
      benchmarkSampleCount: figures?.benchmarkIsModelDefault
        ? 0
        : (figures?.benchmarkSampleCount ?? 0),
      benchmarkCity: figures?.benchmarkCity ?? null,
    });
  }

  return subjects;
}

/**
 * The category ids a scan searched for.
 *
 * `scans.search_terms` is jsonb owned by Phase 1 and shaped
 * `{ categoryIds: [...] , terms: [...] }`. Unknown ids are dropped through the
 * taxonomy so a category removed since the scan ran does not appear as a row
 * nobody can explain.
 */
export function readCategoryIds(searchTerms: Record<string, unknown> | null): string[] {
  const raw = searchTerms?.categoryIds;
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((v): v is string => typeof v === "string");
  return resolveCategories(ids).map((c) => c.id);
}

/** Areas the comparison chip row offers — scored or scanned scans only. */
export async function listComparableScans(identity: ScoutIdentity): Promise<
  Array<{ id: string; areaLabel: string; radiusM: number; scoreTotal: number | null }>
> {
  const rows = await prisma.scan.findMany({
    where: {
      status: { in: ["scanned", "report_sent"] },
      ...ownershipFilter(identity),
    },
    select: { id: true, areaLabel: true, radiusM: true, scoreTotal: true },
    orderBy: { createdAt: "desc" },
    take: 24,
  });

  return rows.map((r) => ({
    id: r.id,
    areaLabel: r.areaLabel,
    radiusM: r.radiusM,
    scoreTotal: r.scoreTotal === null ? null : Number(r.scoreTotal),
  }));
}

/** Team-wide counters for the dashboard lede: "12 areas … across 4 salespeople". */
export async function dashboardSummary(
  identity: ScoutIdentity,
): Promise<{ scansThisMonth: number; owners: number }> {
  // Raw for the `FILTER` and `COUNT(DISTINCT …)`. `::int` on both so they come
  // back as numbers: an uncast `count(*)` is `int8`, which Prisma hands over as
  // a BigInt that `Number()` would then have to unwrap.
  const ownedOnly = canAccessAllScans(identity)
    ? Prisma.empty
    : Prisma.sql`WHERE owner_id = ${identity.userId}`;

  const [row] = await prisma.$queryRaw<Array<{ scansThisMonth: number; owners: number }>>(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS "scansThisMonth",
      count(DISTINCT owner_id)::int AS "owners"
    FROM scans
    ${ownedOnly}
  `);

  return {
    scansThisMonth: Number(row?.scansThisMonth ?? 0),
    owners: Number(row?.owners ?? 0),
  };
}
