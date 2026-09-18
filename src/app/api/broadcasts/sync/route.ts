import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { syncBroadcasts } from "@/lib/broadcast-sync";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const result = await syncBroadcasts();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[broadcast-sync] failed:", err);
    return NextResponse.json({ error: "Broadcast sync failed" }, { status: 502 });
  }
}
