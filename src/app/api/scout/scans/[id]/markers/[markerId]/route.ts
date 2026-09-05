/**
 * `DELETE /api/scout/scans/{id}/markers/{markerId}` — remove a custom map
 * marker.
 *
 * Scoped to the parent scan (not just the marker id) so one scan's markers
 * can never be deleted through another scan's URL, and gated by the same
 * owner-or-admin check every other scan sub-resource uses.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/scout/db";
import { canAccessAllScans, getScoutProfile } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: { id: string; markerId: string } },
) {
  const { id, markerId } = context.params;

  const profile = await getScoutProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!profile.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const scan = await getScan(id);
  // Someone else's scan is a 404, never a 403 — a 403 confirms the id exists.
  if (!scan || (scan.ownerId !== profile.userId && !canAccessAllScans(profile))) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const { count } = await prisma.scanMarker.deleteMany({
    where: { id: markerId, scanId: id },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Marker not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
