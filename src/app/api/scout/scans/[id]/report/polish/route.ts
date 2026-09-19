import { NextResponse } from "next/server";

import { getScoutProfile, canAccessAllScans } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { canGenerateAiSummary, polishSuggestions } from "@/lib/scout/reports/ai-summary";
import { AiError, aiErrorStatus } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;

  const author = await getScoutProfile();
  if (!author) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!author.canRunScans) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const scan = await getScan(id);
  if (!scan || (scan.ownerId !== author.userId && !canAccessAllScans(author))) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  if (!canGenerateAiSummary()) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { rawText } = (body ?? {}) as { rawText?: string };
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    return NextResponse.json({ error: "rawText is required." }, { status: 400 });
  }

  try {
    const polished = await polishSuggestions(author.userId, rawText.trim(), {
      areaLabel: scan.areaLabel ?? "Unknown area",
      radiusM: scan.radiusM ?? 2000,
    });
    return NextResponse.json({ polished });
  } catch (err) {
    console.error(JSON.stringify({ tag: "report.polish.api-error", scanId: id, error: err instanceof Error ? err.message : "unknown" }));
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: aiErrorStatus(err.code) },
      );
    }
    return NextResponse.json({ error: "Polishing failed. Please try again." }, { status: 500 });
  }
}
