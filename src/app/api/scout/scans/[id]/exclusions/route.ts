import { NextResponse } from "next/server";

import { getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import {
  excludePlace,
  getExclusionsForOwner,
  undoExclusion,
} from "@/lib/scout/places/exclusionRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveOwner(scanId: string) {
  const identity = await getScoutIdentity();
  if (!identity) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!identity.canRunScans) return { error: NextResponse.json({ error: "Not permitted." }, { status: 403 }) };

  const scan = await getScan(scanId);
  if (!scan || scan.ownerId !== identity.userId) {
    return { error: NextResponse.json({ error: "Scan not found." }, { status: 404 }) };
  }

  return { identity, scan };
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const resolved = await resolveOwner(id);
  if ("error" in resolved) return resolved.error;

  const rows = await getExclusionsForOwner(resolved.scan.ownerId);
  return NextResponse.json({ exclusions: rows });
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const resolved = await resolveOwner(id);
  if ("error" in resolved) return resolved.error;

  const body = await request.json();
  const { googlePlaceId, categoryId } = body as { googlePlaceId?: string; categoryId?: string };
  if (!googlePlaceId || !categoryId) {
    return NextResponse.json({ error: "googlePlaceId and categoryId are required." }, { status: 400 });
  }

  const row = await excludePlace(resolved.scan.ownerId, googlePlaceId, categoryId, id);
  return NextResponse.json({ exclusion: row }, { status: 201 });
}

export async function DELETE(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const resolved = await resolveOwner(id);
  if ("error" in resolved) return resolved.error;

  const body = await request.json();
  const { exclusionId } = body as { exclusionId?: string };
  if (!exclusionId) {
    return NextResponse.json({ error: "exclusionId is required." }, { status: 400 });
  }

  const deleted = await undoExclusion(exclusionId, resolved.scan.ownerId);
  if (!deleted) {
    return NextResponse.json({ error: "Exclusion not found or locked." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
