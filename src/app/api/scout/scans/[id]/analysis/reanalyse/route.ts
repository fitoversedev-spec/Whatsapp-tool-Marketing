import { NextResponse } from "next/server";
import { after } from "@/lib/scout/after";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { AiError, aiErrorStatus } from "@/lib/ai/errors";
import { aiConfigured } from "@/lib/ai/client";
import {
  getAnalysisByScanAndOwner,
  getAnalysisPlaces,
  getInsightsToReanalyse,
  resetInsightsForReanalysis,
  updateAnalysisStatus,
} from "@/lib/scout/analysis/repository";
import { runAnalysis } from "@/lib/scout/analysis/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
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
    return NextResponse.json({ error: "No analysis to re-run." }, { status: 404 });
  }
  if (analysis.status === "running" || analysis.status === "pending") {
    return NextResponse.json({ error: "Analysis already in progress." }, { status: 409 });
  }

  try {
    const toReanalyse = await getInsightsToReanalyse(analysis.id);
    if (toReanalyse.length === 0) {
      return NextResponse.json(
        { error: "All insights have been edited — nothing to re-analyse." },
        { status: 400 },
      );
    }

    const placeIds = toReanalyse.map((i) => i.placeId);
    await resetInsightsForReanalysis(analysis.id, placeIds);

    const allPlaces = await getAnalysisPlaces(id);
    const places = allPlaces.filter((p) => placeIds.includes(p.placeInternalId));

    await updateAnalysisStatus(analysis.id, "running", {
      startedAt: new Date(),
      completedPlaces: analysis.completedPlaces - places.length,
      failedPlaces: 0,
    });

    const userId = identity.userId;
    const analysisId = analysis.id;

    after(async () => {
      try {
        await runAnalysis(analysisId, userId, places);
      } catch (e) {
        console.error(
          JSON.stringify({
            event: "scout_reanalysis_background_failed",
            analysisId,
            error: e instanceof Error ? e.message : "unknown",
          }),
        );
      }
    });

    return NextResponse.json(
      { scanId: id, analysisId, reanalysingCount: places.length },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: aiErrorStatus(e.code) });
    }
    throw e;
  }
}
