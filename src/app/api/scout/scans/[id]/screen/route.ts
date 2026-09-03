/**
 * `GET /api/scout/scans/{id}/screen` — the D2 payload, refreshed.
 *
 * The same object the server component renders on first paint. It exists so the
 * screen can repaint mid-scan without a full navigation: `GET /api/scout/scans/{id}`
 * would work, but it returns every field of every place — website, phone,
 * opening-hours envelope — for a panel that shows a name, a rating and a
 * distance. On a hundred-place catchment that is the difference between a
 * responsive poll and a stuttering one.
 */

import { NextResponse } from "next/server";

import { getScoutIdentity } from "@/lib/scout/identity";
import { getScanScreenData } from "@/lib/scout/scans/screenData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: { id: string } }) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const { id } = context.params;
  const data = await getScanScreenData(identity, id);
  // Someone else's scan is a 404, not a 403 — a 403 confirms the id exists.
  if (!data) return NextResponse.json({ error: "Scan not found." }, { status: 404 });

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
