// Quadrants & Territory group (Phase 3 analytics v2) — 4 Quadrants +
// Territory share this one route, same as /patterns composes its group in
// one Promise.all. Entirely admin-only per the nav table: a real 401/403
// (not requireAdmin()'s page-redirect), mirroring
// /api/crm/analytics/patterns/route.ts precisely. resolveAnalyticsScope() is
// still called for defense-in-depth even though only admins ever reach here.
// anomalies.ts is deliberately NOT composed here — nothing in the UI
// consumes it this phase (Phase 5's insights.ts is its intended caller).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, type Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { leadSourceQuadrant, productQuadrant, repQuadrant, regionQuadrant } from "@/lib/analytics/quadrants";
import { territoryBubbles } from "@/lib/analytics/territory";

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

  // No pre-applied dates: a blank picker => ALL-TIME data. The fallback
  // window is 2000-01-01..now (wide enough to cover every record) instead
  // of now-30, so an unfiltered first load shows everything. A picked
  // range still narrows to exactly that range.
  const defaultFrom = new Date("2000-01-01T00:00:00Z");

  const from = parseDateParam(req.nextUrl.searchParams.get("from"), defaultFrom);
  const toParam = req.nextUrl.searchParams.get("to");
  const to = toParam ? new Date(toParam + "T23:59:59") : new Date();

  const filter = { from, to, ownerIds: scope.companyWide ? undefined : scope.ownerIds, dealChannel: "crm" as const };

  const [leadSource, product, rep, region, territory] = await Promise.all([
    leadSourceQuadrant(filter),
    productQuadrant(filter),
    repQuadrant(filter),
    regionQuadrant(filter),
    territoryBubbles(filter),
  ]);

  return NextResponse.json({ leadSource, product, rep, region, territory });
}
