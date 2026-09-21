import { NextResponse } from "next/server";
import { after } from "@/lib/scout/after";
import { canAccessAllScans, getScoutProfile } from "@/lib/scout/identity";
import { prisma } from "@/lib/prisma";
import { getScan } from "@/lib/scout/places/scanRepository";
import { AiError, aiErrorStatus } from "@/lib/ai/errors";
import { aiConfigured } from "@/lib/ai/client";
import {
  getAnalysisByScanAndOwner,
  getOriginalAnalysisForScan,
} from "@/lib/scout/analysis/repository";
import { startAnalysis, runAnalysis } from "@/lib/scout/analysis/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function authorise(id: string) {
  const author = await getScoutProfile();
  if (!author) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!author.canRunScans) {
    return { error: NextResponse.json({ error: "Not permitted." }, { status: 403 }) };
  }
  const scan = await getScan(id, prisma as any);
  if (!scan || (scan.ownerId !== author.userId && !canAccessAllScans(author))) {
    return { error: NextResponse.json({ error: "Scan not found." }, { status: 404 }) };
  }
  return { author, scan };
}

function toClientAnalysis(row: NonNullable<Awaited<ReturnType<typeof getAnalysisByScanAndOwner>>>) {
  return {
    id: row.id,
    status: row.status,
    totalPlaces: row.totalPlaces,
    completedPlaces: row.completedPlaces,
    failedPlaces: row.failedPlaces,
    areaSummary: row.areaSummary,
    error: row.error,
    insights: row.insights.map((i) => ({
      insightId: i.id,
      placeName: i.place.name,
      status: i.status,
      establishedDate: i.establishedDate,
      popularTimes: i.popularTimes,
      sentiment: i.sentiment,
      suitability: i.suitability,
      editedFields: i.editedFields,
      error: i.error,
    })),
  };
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const own = await getAnalysisByScanAndOwner(id, auth.author.userId);
  if (own) {
    return NextResponse.json(
      { scanId: id, analysis: toClientAnalysis(own) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const original = await getOriginalAnalysisForScan(id);
  if (original) {
    return NextResponse.json(
      {
        scanId: id,
        analysis: null,
        existingAnalysis: {
          id: original.id,
          ownerId: original.ownerId,
          status: original.status,
          completedPlaces: original.completedPlaces,
          totalPlaces: original.totalPlaces,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { scanId: id, analysis: null, existingAnalysis: null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  if (!aiConfigured()) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const existing = await getAnalysisByScanAndOwner(id, auth.author.userId);
  if (existing && (existing.status === "running" || existing.status === "pending")) {
    return NextResponse.json(
      { error: "Analysis already in progress.", analysis: existing },
      { status: 409 },
    );
  }

  try {
    const { analysisId, places, estimate } = await startAnalysis(id, auth.author.userId);
    const userId = auth.author.userId;

    after(async () => {
      try {
        await runAnalysis(analysisId, userId, places);
      } catch (e) {
        console.error(
          JSON.stringify({
            event: "scout_analysis_background_failed",
            analysisId,
            error: e instanceof Error ? e.message : "unknown",
          }),
        );
      }
    });

    return NextResponse.json(
      { scanId: id, analysisId, estimate },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: aiErrorStatus(e.code) });
    }
    throw e;
  }
}
