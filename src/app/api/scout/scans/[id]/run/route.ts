/**
 * `POST /api/scout/scans/{id}/run` — process one slice of a scan job.
 *
 * The worker mechanism. Called by the client when a poll reports
 * `resumeRequired`, by a cron, or by the `after()` kick-off in
 * `POST /api/scout/scans`. It is idempotent and concurrency-safe: a second caller
 * arriving while a worker holds the lease gets `status: "busy"` and changes
 * nothing, so a jumpy client cannot buy the same tiles twice.
 *
 * ## Why the budget is 45 s
 *
 * Vercel's default function duration is 300 s on every plan, with Pro able to
 * configure up to 800 s. A slice therefore has plenty of headroom at 45 s —
 * the small budget is deliberate. It keeps each invocation short enough that a
 * dropped connection loses seconds of work rather than minutes, and it means
 * the design never depends on the timeout being generous. If the client moves
 * to a plan with a shorter limit, `SCAN_WORKER_BUDGET_MS` is the only number
 * that changes.
 */

import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { getScan } from "@/lib/scout/places/scanRepository";
import { runScanSlice } from "@/lib/scout/places/scanPipeline";

export const runtime = "nodejs";
/** Comfortably above the 45 s slice budget, comfortably inside every plan. */
export const maxDuration = 120;

export async function POST(_request: Request, context: { params: { id: string } }) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  if (!env.hasGoogleServerKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_SERVER_KEY is not configured.", code: "NO_API_KEY" },
      { status: 503 },
    );
  }

  const { id } = context.params;

  const scan = await getScan(id);
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  if (scan.ownerId !== identity.userId && !canAccessAllScans(identity)) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const result = await runScanSlice(id);

  // 200 for a finished scan, 202 for one that still has work: the status code
  // alone tells a polling client whether to call again.
  const status = result.status === "completed" || result.status === "failed" ? 200 : 202;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
