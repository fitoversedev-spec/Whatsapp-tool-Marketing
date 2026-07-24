// CRM-wide analytics — the single analytics surface in the app (Team
// Performance / "WhatsApp Sales Analytics", the older /team page this was
// once one of two parallel systems alongside, was removed once every deal
// creation path started routing through the CRM contact model — see
// docs/DECISIONS.md). Open to every approved role — resolveAnalyticsScope()
// below is what actually decides whose deals a given request can see, not
// this route's own gate.
//
// Split out of the former /api/crm/analytics/route.ts (Phase 0) so this
// endpoint doesn't keep growing into one ever-larger Promise.all as later
// analytics groups (Comparators, Quadrants, Industry Insights, ...) ship
// their own routes instead — see docs/DECISIONS.md.
//
// Perf: customerSegments/timelineMetrics/forecast used to also get called
// here (Team Performance's client rendered them; this route's client,
// CrmAnalyticsClient.tsx, never did), so they were dropped from this route
// as dead weight before Team Performance itself was deleted entirely along
// with the underlying customers.ts/forecast.ts files and timelineMetrics()
// — see docs/DECISIONS.md.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, type Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { salesActivity } from "@/lib/analytics/salesActivity";
import { funnelSnapshot } from "@/lib/analytics/funnel";
import { productAnalytics } from "@/lib/analytics/products";
import { sourceAnalytics } from "@/lib/analytics/sources";
import { stageVelocity } from "@/lib/analytics/timelines";
import { geography } from "@/lib/analytics/geography";

export const runtime = "nodejs";
export const maxDuration = 30;

// Explicit start/end dates (YYYY-MM-DD) picked from a calendar, replacing
// the old 7d/30d/90d/all preset — see docs/DECISIONS.md. Defaults to an
// all-time window when neither is given (no date pre-applied — the picker
// starts blank and only filters once the user applies a range).
function parseDateParam(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = resolveAnalyticsScope({ id: user.id, role: user.role as Role });

  // No pre-applied dates: a blank picker => ALL-TIME data. The fallback
  // window is 2000-01-01..now (wide enough to cover every record) instead
  // of now-30, so an unfiltered first load shows everything. A picked
  // range still narrows to exactly that range.
  const defaultFrom = new Date("2000-01-01T00:00:00Z");

  const from = parseDateParam(req.nextUrl.searchParams.get("from"), defaultFrom);
  const toParam = req.nextUrl.searchParams.get("to");
  const to = toParam ? new Date(toParam + "T23:59:59") : new Date();

  // An "owner" query param can only ever narrow an admin's company-wide
  // view — for a non-admin, resolveAnalyticsScope()'s own ownerIds always
  // wins, regardless of what the client asked for.
  const ownerParam = req.nextUrl.searchParams.get("owner");
  const requestedOwnerIds = ownerParam && ownerParam !== "all" ? [ownerParam] : undefined;
  const ownerIds = scope.companyWide ? requestedOwnerIds : scope.ownerIds;

  // dealChannel: "crm" is now mostly a defensive filter rather than a real
  // split — every deal creation path stamps "crm" going forward (see
  // findOrCreateDealForConversation), and the ~32 legacy dealChannel:
  // "whatsapp" deals from before that change are soft-deleted (see
  // docs/DECISIONS.md) — but keeping the filter costs nothing and guards
  // against any future path that forgets to set it.
  const filter = { from, to, ownerIds, dealChannel: "crm" as const };

  const [salesActivityRows, funnel, products, sources, stageVelocityRows, geo] = await Promise.all([
    salesActivity(filter),
    funnelSnapshot(filter),
    productAnalytics(filter),
    sourceAnalytics(filter),
    stageVelocity(filter),
    geography(filter),
  ]);

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    isAdmin: isAdmin(user.role),
    salesActivity: salesActivityRows,
    funnel,
    products,
    sources,
    stageVelocity: stageVelocityRows,
    geography: geo,
  });
}
