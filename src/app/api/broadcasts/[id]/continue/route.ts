// Internal hand-over between broadcast slices (src/lib/broadcast-chain.ts):
// a sending run calls this on its own deployment when its ~45 s are up, and
// this fresh run sends the next slice after replying. Not for browsers — the
// request must carry a recent signature made with the server's secret.

import { NextRequest, NextResponse } from "next/server";
import { sendInBackground, verifyHandOff } from "@/lib/broadcast-chain";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!verifyHandOff(params.id, body?.ts, body?.sig)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  sendInBackground(req.nextUrl.origin, params.id);
  return NextResponse.json({ ok: true }, { status: 202 });
}
