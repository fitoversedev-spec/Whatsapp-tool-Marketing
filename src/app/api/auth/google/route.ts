import { NextResponse } from "next/server";
import { GOOGLE_STATE_COOKIE, googleStateCookieOptions, newGoogleState } from "@/lib/google-oauth-state";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  "https://whatsapp-tool-marketing.vercel.app";

// Next 14 caches a GET handler that doesn't read the request, which would hand every visitor the same state.
export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Google login not configured" },
      { status: 500 }
    );
  }

  const state = newGoogleState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${BASE_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
  res.cookies.set(GOOGLE_STATE_COOKIE, state, googleStateCookieOptions);
  return res;
}
