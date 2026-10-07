// Where to send someone after they sign in (the `?next=` on /login): only a
// page on this site — never another site, an API route or the sign-in pages
// themselves. Anything else gives null (→ the default, /inbox).
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw.startsWith("/api/")) return null;
  if (/^\/(login|signup|forgot-password|reset-password)(\/|\?|#|$)/.test(raw)) return null;
  return raw;
}
