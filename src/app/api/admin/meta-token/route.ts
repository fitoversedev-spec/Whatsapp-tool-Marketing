// Token management API.
//
// GET  /api/admin/meta-token        — returns current token status (expiry, days remaining)
// POST /api/admin/meta-token        — body: { token } — exchanges the supplied short-lived
//                                     user token for a 60-day long-lived token and persists.
// POST /api/admin/meta-token/refresh — forces a refresh of the currently-stored token

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exchangeForLongToken, getTokenStatus } from "@/lib/token-manager";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const status = await getTokenStatus();
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const inputToken: string | undefined = body?.token?.trim();
  if (!inputToken) {
    return NextResponse.json({ error: "token is required in body" }, { status: 400 });
  }

  try {
    const result = await exchangeForLongToken(inputToken);
    return NextResponse.json({
      ok: true,
      expiresAt: result.expiresAt,
      expiresAtIso: new Date(result.expiresAt * 1000).toISOString(),
      daysUntilExpiry: Math.floor((result.expiresAt - Date.now() / 1000) / (24 * 60 * 60)),
    });
  } catch (err: any) {
    const message =
      err?.response?.data?.error?.message ?? err?.message ?? "Token exchange failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
