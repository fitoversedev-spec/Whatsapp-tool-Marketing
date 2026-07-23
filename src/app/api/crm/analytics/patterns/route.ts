// Comparisons & Patterns group (Phase 2 analytics v2) — Comparators,
// Funnel Patterns, Cohorts all share this one route/fetch, same as
// /performance composes its group in one Promise.all. Entirely admin-only
// per the nav table (spec plan Phase 0's two-level nav) — not just scoped
// via resolveAnalyticsScope() like every other analytics route, a real 403
// for non-admin, mirroring /api/admin/targets/route.ts's non-redirect JSON
// auth pattern (requireAdmin() calls next/navigation's redirect(), which is
// for pages, not JSON routes). resolveAnalyticsScope() is still called for
// defense-in-depth even though only admins ever reach here.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, type Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { repComparison, dimensionComparison, fyComparison } from "@/lib/analytics/comparators";
import { segmentFunnel, sourcePathFunnel, valueFunnel } from "@/lib/analytics/funnelSegments";
import { enquiryCohort, repeatPurchaseCohort } from "@/lib/analytics/cohorts";

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

  const [repRows, region, sector, product, source, fyPair, segments, sourcePaths, valueByStage, enquiryCohorts, repeatPurchase] =
    await Promise.all([
      repComparison(filter),
      dimensionComparison("region", filter),
      dimensionComparison("sector", filter),
      dimensionComparison("product", filter),
      dimensionComparison("source", filter),
      fyComparison(filter),
      segmentFunnel(filter),
      sourcePathFunnel(filter),
      valueFunnel(filter),
      enquiryCohort(filter),
      repeatPurchaseCohort(filter),
    ]);

  return NextResponse.json({
    repComparison: repRows,
    dimensions: { region, sector, product, source },
    fyComparison: fyPair,
    funnel: { segments, sourcePaths, valueByStage },
    cohorts: { enquiry: enquiryCohorts, repeatPurchase },
  });
}
