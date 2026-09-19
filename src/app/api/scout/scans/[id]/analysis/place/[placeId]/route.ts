import { NextResponse } from "next/server";
import { after } from "@/lib/scout/after";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { AiError, aiErrorStatus } from "@/lib/ai/errors";
import { aiConfigured } from "@/lib/ai/client";
import {
  getAnalysisByScanAndOwner,
  getAnalysisPlaces,
} from "@/lib/scout/analysis/repository";
import { analyseSinglePlace } from "@/lib/scout/analysis/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: { id: string; placeId: string } },
) {
  const { id, placeId } = context.params;
  const identity = await getScoutIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!identity.canRunScans) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }
  const scan = await getScan(id);
  if (!scan || (scan.ownerId !== identity.userId && !canAccessAllScans(identity))) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  if (!aiConfigured()) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const analysis = await getAnalysisByScanAndOwner(id, identity.userId);
  if (!analysis) {
    return NextResponse.json({ error: "Start a full analysis first." }, { status: 400 });
  }

  const places = await getAnalysisPlaces(id);
  const place = places.find((p) => p.placeInternalId === placeId);
  if (!place) {
    return NextResponse.json({ error: "Place not found in this scan." }, { status: 404 });
  }

  const userId = identity.userId;
  const analysisId = analysis.id;

  after(async () => {
    try {
      await analyseSinglePlace(analysisId, userId, place);
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "scout_analysis_single_place_failed",
          analysisId,
          placeId,
          error: e instanceof Error ? e.message : "unknown",
        }),
      );
    }
  });

  return NextResponse.json(
    { scanId: id, analysisId, placeId },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
