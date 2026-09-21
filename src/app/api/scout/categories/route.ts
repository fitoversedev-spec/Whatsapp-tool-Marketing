import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/scout/db";
import { getScoutIdentity } from "@/lib/scout/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const categories = await prisma.customCategory.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    { categories },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const body = raw as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const side = body.side;
  const searchQuery = typeof body.searchQuery === "string" ? body.searchQuery.trim() : "";
  const googleType = typeof body.googleType === "string" ? body.googleType.trim() || null : null;

  if (!label || label.length > 60) {
    return NextResponse.json({ error: "Label required (max 60 chars)." }, { status: 400 });
  }
  if (side !== "competition" && side !== "demand") {
    return NextResponse.json({ error: "Side must be 'competition' or 'demand'." }, { status: 400 });
  }
  if (!searchQuery || searchQuery.length > 120) {
    return NextResponse.json({ error: "Search query required (max 120 chars)." }, { status: 400 });
  }

  const category = await prisma.customCategory.upsert({
    where: { side_label: { side, label } },
    create: {
      label,
      side,
      searchQuery,
      googleType,
      createdBy: identity.userId,
    },
    update: {},
  });

  return NextResponse.json({ category }, { status: 200 });
}
