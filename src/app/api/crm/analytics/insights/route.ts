// Industry Insights group (Phase 4 analytics v2) — Seasonality, Referral
// Partners, Requirement Fingerprint, Win/Loss by Segment, Execution Pipeline
// share this one route, same one-route-per-nav-group convention as /patterns
// and /quadrants. Entirely admin-only per the nav table: a real 401/403 (not
// requireAdmin()'s page-redirect), mirroring those two routes precisely.
// resolveAnalyticsScope() is still called for defense-in-depth even though
// only admins ever reach here.
//
// Named "insights" rather than "industry" — deliberately distinct from
// Phase 5's future deterministic insight-FEED engine (insights.ts / the
// "Insight Feed" nav tab under "Insights & Digest"), which will need its own
// route later; "industry" was considered but reads ambiguous next to that
// upcoming route, so "insights" (this group's literal nav-table name minus
// "Industry") is clearer and still non-colliding.
//
// winLossBySegment() is called once per dimension (sector/region/product)
// upfront rather than lazily via a query param — same "return the whole
// group's data in one shot" shape /patterns and /quadrants already use, and
// each dimension is a single cheap findMany, not worth deferring.
//
// requirementFingerprint()'s rows only carry a profileName string (no id —
// see requirementFingerprint.ts), but the UI's drill-to-deals needs a real
// CustomerProfile id (dealsDrilldown.ts's customerProfileId filter). Rather
// than reshaping requirementFingerprint.ts (out of scope this task), this
// route does one extra light lookup — CustomerProfile.name -> id — and
// stitches the id onto each fingerprint row and onto the "sector" dimension
// of winLossBySegment (same profileName-keyed convention), which is exactly
// the kind of composition-layer work this route already does.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, type Role } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { seasonality } from "@/lib/analytics/seasonality";
import { referralScoreboard } from "@/lib/analytics/referralScoreboard";
import { requirementFingerprint } from "@/lib/analytics/requirementFingerprint";
import { winLossBySegment } from "@/lib/analytics/winLossSegment";
import { executionSummary } from "@/lib/analytics/execution";

export const runtime = "nodejs";
export const maxDuration = 30;

function parseDateParam(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const scope = resolveAnalyticsScope({ id: user.id, role: user.role as Role });

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = parseDateParam(req.nextUrl.searchParams.get("from"), defaultFrom);
  const toParam = req.nextUrl.searchParams.get("to");
  const to = toParam ? new Date(toParam + "T23:59:59") : new Date();

  const filter = { from, to, ownerIds: scope.companyWide ? undefined : scope.ownerIds, dealChannel: "crm" as const };

  const [seasonalityResult, referral, fingerprint, winLossSector, winLossRegion, winLossProduct, execution, profiles] =
    await Promise.all([
      seasonality(filter),
      referralScoreboard(filter),
      requirementFingerprint(filter),
      winLossBySegment("sector", filter),
      winLossBySegment("region", filter),
      winLossBySegment("product", filter),
      executionSummary(filter),
      prisma.customerProfile.findMany({ select: { id: true, name: true } }),
    ]);

  const profileIdByName = new Map(profiles.map((p) => [p.name, p.id]));
  const fingerprintWithIds = fingerprint.map((row) => ({ ...row, customerProfileId: profileIdByName.get(row.profileName) ?? null }));
  const winLossSectorWithIds = winLossSector.map((row) => ({ ...row, customerProfileId: profileIdByName.get(row.segmentLabel) ?? null }));

  return NextResponse.json({
    seasonality: seasonalityResult,
    referral,
    fingerprint: fingerprintWithIds,
    winLoss: { sector: winLossSectorWithIds, region: winLossRegion, product: winLossProduct },
    execution,
  });
}
