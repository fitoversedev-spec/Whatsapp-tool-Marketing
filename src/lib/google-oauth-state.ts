import crypto from "crypto";

// CSRF protection for Google sign-in: /api/auth/google puts a random `state` in both the authorize URL and this
// cookie, and the callback only accepts a code whose `state` matches the cookie — so nobody can finish a sign-in
// in your browser with a code from a flow they started themselves.
export const GOOGLE_STATE_COOKIE = "g_oauth_state";
// Where to go after a successful Google sign-in (the login page's ?next=).
// Same short-lived, path-scoped cookie options as the state.
export const GOOGLE_NEXT_COOKIE = "g_oauth_next";

export const googleStateCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Lax, not Strict: the cookie must ride along on the top-level redirect back from accounts.google.com.
  sameSite: "lax" as const,
  // Only sent to /api/auth/google and /api/auth/google/callback.
  path: "/api/auth/google",
  maxAge: 60 * 10,
};

export function newGoogleState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function googleStateMatches(fromQuery: string | null, fromCookie: string | undefined): boolean {
  if (!fromQuery || !fromCookie) return false;
  const a = Buffer.from(fromQuery);
  const b = Buffer.from(fromCookie);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
