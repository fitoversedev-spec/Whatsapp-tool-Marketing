// On-load safety net. The dashboard layout fires this in the background once
// per ~5 minutes (rate-limited client-side) so Hobby users don't suffer the
// ~24h cron delay. Requires an authenticated session — no token needed.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sweepAll } from "@/lib/cron-runner";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await sweepAll();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
