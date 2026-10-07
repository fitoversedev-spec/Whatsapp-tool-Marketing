import { NextResponse } from "next/server";

// Read the key per request — Next 14 would otherwise bake this GET into the
// build, freezing whatever the key was (or a 503) at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  return NextResponse.json({ publicKey: key });
}
