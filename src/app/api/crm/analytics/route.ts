// CRM-wide analytics — the single analytics surface in the app (Team
// Performance / "WhatsApp Sales Analytics", the older /team page this was
// once one of two parallel systems alongside, was removed once every deal
// creation path started routing through the CRM contact model — see
// docs/DECISIONS.md). Admin-only.
//
// Perf: customerSegments/timelineMetrics/forecast used to also get called
// here (Team Performance's client rendered them; this route's client,
// CrmAnalyticsClient.tsx, never did), so they were dropped from this route
// as dead weight before Team Performance itself was deleted entirely along
// with the underlying customers.ts/forecast.ts files and timelineMetrics()
// — see docs/DECISIONS.md.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { salesActivity } from "@/lib/analytics/salesActivity";
import { funnelSnapshot } from "@/lib/analytics/funnel";
import { productAnalytics } from "@/lib/analytics/products";
import { sourceAnalytics } from "@/lib/analytics/sources";
import { stageVelocity } from "@/lib/analytics/timelines";
import { geography } from "@/lib/analytics/geography";

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
