// CRM-wide analytics — reuses 5 of the same 9 analytics functions Team
// Performance's API calls, but scoped to ALL deals regardless of source
// (not just WhatsApp-linked ones). Admin-only, same as Team Performance
// (/team) — Sales does not get a self-scoped view here.
// None of these functions filter by conversationId/WhatsApp-only —
// confirmed real reuse, not a parallel analytics engine.
//
// Perf: geography/customerSegments/timelineMetrics/forecast were originally
// called here too (all 9), but CrmAnalyticsClient.tsx's 4 tabs (individual/
// overall/products/platforms) never read geography, customers, timelines,
// or forecast off the response — only salesActivity, funnel, products,
// sources, stageVelocity. Those 4 extra calls (incl. timelineMetrics, which
// does an unfiltered deal.findMany — see its own file) ran and were
// serialized into the JSON on every load/date-range change for nothing.
// Team Performance's own route (src/app/api/team/analytics/route.ts) still
// calls all 4 — its client actually renders them — so they stay there.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { salesActivity } from "@/lib/analytics/salesActivity";
import { funnelSnapshot } from "@/lib/analytics/funnel";
import { productAnalytics } from "@/lib/analytics/products";
import { sourceAnalytics } from "@/lib/analytics/sources";
import { stageVelocity } from "@/lib/analytics/timelines";

export const runtime = "nodejs";
export const maxDuration = 30;

// Explicit start/end dates (YYYY-MM-DD) picked from a calendar, replacing
// the old 7d/30d/90d/all preset — see docs/DECISIONS.md. Defaults to the
// last 30 days when neither is given (first load, no filter chosen yet).
function parseDateParam(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) {
    return NextResponse.json({ error: "forbidden", message: "Admin only" }, { status: 403 });
  }

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = parseDateParam(req.nextUrl.searchParams.get("from"), defaultFrom);
  const toParam = req.nextUrl.searchParams.get("to");
  const to = toParam ? new Date(toParam + "T23:59:59") : new Date();

  const ownerParam = req.nextUrl.searchParams.get("owner");
  const ownerIds = ownerParam && ownerParam !== "all" ? [ownerParam] : undefined;

  // dealChannel: "crm" is what makes this route actually CRM-only — without
  // it every one of these 5 functions (shared verbatim with /api/team/
  // analytics) counts every Deal regardless of source, so the pre-CRM/
  // WhatsApp-originated deals (all 32 real deals as of 2026-07-20, see
  // docs/DECISIONS.md) leaked into every screen here. Team Performance's
  // own route intentionally never sets this — it's supposed to show
  // everything.
  const filter = { from, to, ownerIds, dealChannel: "crm" as const };

  const [salesActivityRows, funnel, products, sources, stageVelocityRows] = await Promise.all([
    salesActivity(filter),
    funnelSnapshot(filter),
    productAnalytics(filter),
    sourceAnalytics(filter),
    stageVelocity(filter),
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
  });
}
