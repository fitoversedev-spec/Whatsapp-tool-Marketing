/**
 * `GET /api/scout/scans/{id}` — the full scan result.
 *
 * Safe to call while the scan is still running: it returns whatever has landed
 * so far, so the UI can paint results progressively instead of holding a
 * spinner for two minutes. `progress.fraction` says how much of the picture
 * this is.
 */

import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { getScanResult } from "@/lib/scout/places/scanResult";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: { id: string } }) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const { id } = context.params;

  const scan = await getScan(id);
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  // Admins can read any scan; a salesperson reads their own.
  if (scan.ownerId !== identity.userId && !canAccessAllScans(identity)) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const result = await getScanResult(id);
  return NextResponse.json(result);
}
