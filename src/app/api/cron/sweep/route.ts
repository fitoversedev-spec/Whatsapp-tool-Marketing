// Vercel Cron entry point. Configured in vercel.json.
// On Hobby the schedule effectively runs ~once per day; the dashboard
// /api/cron/tick endpoint provides on-load safety net coverage.

import { NextRequest, NextResponse } from "next/server";
import { sweepAll } from "@/lib/cron-runner";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Vercel cron injects an Authorization: Bearer <CRON_SECRET> header when
  // the env var is set; we require it in production. Locally we allow any
  // GET so we can test by curling the endpoint.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get("authorization") || "";
    if (got !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  try {
    const result = await sweepAll();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/sweep] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
