/**
 * `GET /api/scout/scans/{id}/progress` — the progress channel.
 *
 * Cheap enough to poll every second or two: one indexed row plus a lease
 * check, no aggregation over places. The response carries `resumeRequired`,
 * which is how a scan survives a client disconnect — if the browser that
 * started the scan is closed, the next caller sees `resumeRequired: true` and
 * POSTs the run endpoint to pick up from exactly where the work stopped.
 */

import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { getScanProgress } from "@/lib/scout/places/scanResult";

export const runtime = "nodejs";
/** Progress is a live value; a cached one is worse than useless. */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: { id: string } }) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const { id } = context.params;

  const scan = await getScan(id);
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  if (scan.ownerId !== identity.userId && !canAccessAllScans(identity)) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const progress = await getScanProgress(id);
  if (!progress) return NextResponse.json({ error: "Scan has no job." }, { status: 404 });

  return NextResponse.json(progress, {
    headers: { "Cache-Control": "no-store" },
  });
}
