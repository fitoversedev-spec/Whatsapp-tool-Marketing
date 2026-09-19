import { NextResponse } from "next/server";
import { getScoutIdentity } from "@/lib/scout/identity";
import { prisma } from "@/lib/prisma";
import { saveInsightEdits } from "@/lib/scout/analysis/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: { id: string; insightId: string } },
) {
  const { insightId } = context.params;
  const identity = await getScoutIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const insight = await prisma.scoutPlaceInsight.findUnique({
    where: { id: insightId },
    include: { analysis: { select: { ownerId: true } } },
  });
  if (!insight || insight.analysis.ownerId !== identity.userId) {
    return NextResponse.json({ error: "Insight not found." }, { status: 404 });
  }

  const body = await request.json();
  const editedFields = body.editedFields;
  if (!editedFields || typeof editedFields !== "object") {
    return NextResponse.json({ error: "editedFields required." }, { status: 400 });
  }

  const updated = await saveInsightEdits(insightId, editedFields);

  return NextResponse.json({ insight: updated }, { headers: { "Cache-Control": "no-store" } });
}

export { PUT as PATCH };
