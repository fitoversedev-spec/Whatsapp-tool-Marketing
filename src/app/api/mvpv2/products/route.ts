// Server-side proxy to the MVPv2 product API. The wizard's Sport Data
// Panel calls this instead of hitting fitoverse.vercel.app directly to
// avoid any CORS headaches. Auth-gated so we don't accidentally expose
// the MVPv2 firehose to the world (rate limit-friendly for our own
// authenticated users).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listProductsBySport } from "@/lib/mvpv2/products";
import type { SportKey } from "@/lib/catalogue/sport-meta";

const VALID: Set<SportKey> = new Set([
  "football",
  "cricket",
  "basketball",
  "pickleball",
  "tennis",
  "badminton",
  "volleyball",
  "multisport",
]);

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sport = req.nextUrl.searchParams.get("sport") ?? "";
  if (!VALID.has(sport as SportKey)) {
    return NextResponse.json({ error: "invalid_sport" }, { status: 400 });
  }
  const products = await listProductsBySport(sport as SportKey);
  return NextResponse.json({ products });
}
