/**
 * `GET /api/scout/scans/estimate` — live cost estimate as categories are ticked, and
 * `GET /api/scout/scans/estimate?taxonomy=1` — the category/preset picker data.
 *
 * Pure computation, no database and no Google call, so it is safe to hit on
 * every keystroke. The client's warning in `CLIENT-INPUTS.md` is that a Full
 * sweep costs roughly five times a Quick check; this is what lets the scan
 * screen say so **before** the scan runs rather than after.
 */

import { NextResponse, type NextRequest } from "next/server";

import { getScoutIdentity } from "@/lib/scout/identity";
import { estimateScan, formatDuration } from "@/lib/scout/places/estimate";
import { categoriesForPreset, publicTaxonomy } from "@/lib/scout/places/taxonomy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const params = request.nextUrl.searchParams;

  if (params.get("taxonomy") === "1") {
    return NextResponse.json(publicTaxonomy());
  }

  const radiusM = Number(params.get("radiusM") ?? 2_000);
  const presetId = params.get("preset");
  const categoryIds = presetId
    ? categoriesForPreset(presetId).map((c) => c.id)
    : (params.get("categoryIds")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []);

  const estimate = estimateScan({ categoryIds, radiusM, cacheHitRate: 0.15 });

  return NextResponse.json({
    ...estimate,
    categoryIds,
    radiusM,
    durationLabel: formatDuration(estimate.estimatedDurationMs),
  });
}
