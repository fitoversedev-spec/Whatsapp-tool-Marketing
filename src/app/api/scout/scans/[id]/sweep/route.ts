/**
 * `GET /api/scout/scans/{id}/sweep` — the stored spaces sweep for a scan.
 * `PUT /api/scout/scans/{id}/sweep` — replace it.
 *
 * v16 kept sweeps in `localStorage`, keyed on a typed area name. A morning's
 * fieldwork therefore lived in one browser profile, was invisible to the rest
 * of the team, and was lost by clearing site data. This stores it on the scan.
 *
 * The PUT replaces the whole document rather than patching cells. A split turns
 * one cell into four and a resize replans the grid, so "what changed" is rarely
 * a single row — and one UPDATE means a concurrent reader never sees a
 * half-applied grid.
 */

import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { parseSweepDocument } from "@/lib/scout/sweep/grid";
import { getSweep, saveSweep } from "@/lib/scout/sweep/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorise(id: string) {
  const identity = await getScoutIdentity();
  if (!identity) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!identity.canRunScans) {
    return { error: NextResponse.json({ error: "Not permitted." }, { status: 403 }) };
  }
  const scan = await getScan(id);
  // Someone else's scan is a 404, not a 403 — a 403 confirms the id exists.
  if (!scan || (scan.ownerId !== identity.userId && !canAccessAllScans(identity))) {
    return { error: NextResponse.json({ error: "Scan not found." }, { status: 404 }) };
  }
  return { identity, scan };
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const sweep = await getSweep(id);
  return NextResponse.json(
    {
      scanId: id,
      areaLabel: auth.scan.areaLabel,
      centre: auth.scan.centre,
      radiusM: auth.scan.radiusM,
      sweep,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const doc = parseSweepDocument((body as { sweep?: unknown })?.sweep ?? body);
  if (!doc) {
    return NextResponse.json(
      {
        error:
          "That is not a sweep. It needs a bounds object and a cells array; " +
          "cells without usable bounds are dropped rather than repaired.",
      },
      { status: 400 },
    );
  }

  const saved = await saveSweep(id, doc);
  return NextResponse.json({ scanId: id, sweep: saved }, { headers: { "Cache-Control": "no-store" } });
}
