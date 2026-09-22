import { NextResponse } from "next/server";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { prisma } from "@/lib/prisma";
import { getScan } from "@/lib/scout/places/scanRepository";
import { getAnalysisPlaces } from "@/lib/scout/analysis/repository";
import { estimateAnalysisCost } from "@/lib/scout/analysis/estimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const identity = await getScoutIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!identity.canRunScans) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }
  const scan = await getScan(id, prisma as any);
  if (!scan || (scan.ownerId !== identity.userId && !canAccessAllScans(identity))) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const places = await getAnalysisPlaces(id);
  const estimate = estimateAnalysisCost(places.length);

  return NextResponse.json(
    {
      scanId: id,
      estimate,
      places: places.map((p) => ({
        googlePlaceId: p.googlePlaceId,
        name: p.name,
        rating: p.rating,
        reviewCount: p.reviewCount,
        primaryType: p.primaryTypeDisplayName ?? p.primaryType ?? null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
