import { NextResponse } from "next/server";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { prisma } from "@/lib/prisma";
import { getScan } from "@/lib/scout/places/scanRepository";
import {
  getAnalysisByScanAndOwner,
  getOriginalAnalysisForScan,
  cloneAnalysis,
} from "@/lib/scout/analysis/repository";

export const runtime = "nodejs";
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
  const scan = await getScan(id, prisma as any);
  if (!scan || (scan.ownerId !== identity.userId && !canAccessAllScans(identity))) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const existing = await getAnalysisByScanAndOwner(id, identity.userId);
  if (existing) {
    return NextResponse.json(
      { error: "You already have an analysis for this scan.", analysis: existing },
      { status: 409 },
    );
  }

  const original = await getOriginalAnalysisForScan(id);
  if (!original) {
    return NextResponse.json({ error: "No completed analysis to clone." }, { status: 404 });
  }

  const clone = await cloneAnalysis(original.id, identity.userId);

  return NextResponse.json(
    { scanId: id, analysis: clone },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
