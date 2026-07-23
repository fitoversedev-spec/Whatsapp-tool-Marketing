// Performance -> Overview tab's data (Phase 1 analytics v2, spec §11.3 KPI
// board). Split from /api/crm/analytics/performance/route.ts as a sibling
// rather than grown into it — this endpoint needs an extra period/target
// concept the other 6 functions there don't (see docs/DECISIONS.md on not
// growing one endpoint indefinitely). Auth/scope pattern matches
// /performance exactly: getCurrentUser() + resolveAnalyticsScope() first, a
// client-supplied owner can only ever narrow an admin's view.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, type Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { getKpiBoard } from "@/lib/analytics/kpiBoard";

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

  const scope = resolveAnalyticsScope({ id: user.id, role: user.role as Role });

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = parseDateParam(req.nextUrl.searchParams.get("from"), defaultFrom);
  const toParam = req.nextUrl.searchParams.get("to");
  const to = toParam ? new Date(toParam + "T23:59:59") : new Date();

  // Same owner-narrowing rule as /performance: a query param can only ever
  // narrow an admin's company-wide view — a non-admin's own scope always wins.
  const ownerParam = req.nextUrl.searchParams.get("owner");
  const requestedOwnerIds = ownerParam && ownerParam !== "all" ? [ownerParam] : undefined;
  const ownerIds = scope.companyWide ? requestedOwnerIds : scope.ownerIds;

  const filter = { from, to, ownerIds, dealChannel: "crm" as const };
  const board = await getKpiBoard({ id: user.id, role: user.role as Role }, filter, { start: from, end: to });

  return NextResponse.json({ isAdmin: isAdmin(user.role), ...board });
}
