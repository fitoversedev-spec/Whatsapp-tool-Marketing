/**
 * `GET /api/admin/usage` — Google API spend by user and by day.
 *
 * Admin only. Phase 7 builds the screen; this is the data behind it, and it is
 * also the endpoint that answers "what does a scan actually cost" once a key
 * exists (see docs/PHASE-1-UNVERIFIED.md → V4).
 */

import { NextResponse, type NextRequest } from "next/server";

import { getScoutIdentity } from "@/lib/scout/identity";
import { placesConfig } from "@/lib/scout/places/config";
import { getScanCost, getUsageByUserAndDay } from "@/lib/scout/places/metering";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Admin gate 3 of 3 — see `src/app/(app)/admin/layout.tsx` and
  // `src/app/(app)/admin/actions.ts`.
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canEditScoringWeights) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;

  // `?scanId=` answers the cost-per-scan question directly.
  const scanId = params.get("scanId");
  if (scanId) {
    return NextResponse.json({ scanId, ...(await getScanCost(scanId)) });
  }

  const days = Math.min(365, Math.max(1, Number(params.get("days") ?? 30)));
  const rows = await getUsageByUserAndDay(days);

  const totals = rows.reduce(
    (acc, row) => ({
      calls: acc.calls + row.calls,
      cacheHits: acc.cacheHits + row.cacheHits,
      costUsd: acc.costUsd + row.costUsd,
    }),
    { calls: 0, cacheHits: 0, costUsd: 0 },
  );

  return NextResponse.json({
    days,
    dailyCallCap: placesConfig.dailyCallCap,
    totals: { ...totals, costUsd: Math.round(totals.costUsd * 10_000) / 10_000 },
    // Cache hit rate is the number that should climb as the team re-scans
    // familiar ground; a flat one means the cache is not earning its keep.
    cacheHitRate:
      totals.calls + totals.cacheHits === 0
        ? 0
        : Math.round((totals.cacheHits / (totals.calls + totals.cacheHits)) * 1000) / 1000,
    rows,
  });
}
