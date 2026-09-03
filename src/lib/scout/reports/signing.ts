/**
 * Signed, expiring report links.
 *
 * A report is one customer's site assessment. It must not sit behind a
 * permanently public, guessable URL — and equally it must be openable by a land
 * owner who has no account, from a WhatsApp message, on a phone, weeks later.
 * Those two requirements meet at a signed link with an expiry in the signature.
 *
 * ## The shape
 *
 *     /r/{reportId}?e={unixSeconds}&s={base64url HMAC-SHA256}
 *
 * The signature covers the report id **and** the expiry, so moving the expiry
 * forward invalidates it — an attacker cannot extend their own link by editing
 * the query string. Verification is constant-time.
 *
 * ## What this is not
 *
 * It is not a capability that can be revoked mid-flight. Revocation would need
 * a per-report secret stored alongside the row and rotated on demand; the token
 * is derived from `AUTH_SECRET`, so the only revocation available today is
 * rotating that secret, which invalidates every link and every session at once.
 * That is a deliberate simplification for a 90-day link and it is written down
 * here rather than discovered later. Deleting the report row also stops the
 * link: the route looks the row up before it serves anything.
 *
 * The token is derived, never stored. There is no column holding a live
 * credential, so a database dump does not hand over working links to every
 * report ever produced.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** 90 days, per the brief. `REPORT_LINK_TTL_DAYS` overrides it. */
export const DEFAULT_LINK_TTL_DAYS = 90;

export function linkTtlDays(): number {
  const raw = Number(process.env.REPORT_LINK_TTL_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LINK_TTL_DAYS;
  return Math.min(Math.floor(raw), 365 * 5);
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(reportId: string, expiresAtSeconds: number, secret: string): string {
  return base64url(
    createHmac("sha256", secret).update(`report:${reportId}:${expiresAtSeconds}`).digest(),
  );
}

export interface SignedLink {
  readonly path: string;
  readonly expiresAt: Date;
  readonly signature: string;
}

export function signReportLink(
  reportId: string,
  secret: string,
  expiresAt: Date,
): SignedLink {
  const seconds = Math.floor(expiresAt.getTime() / 1000);
  const signature = sign(reportId, seconds, secret);
  return {
    path: `/r/${reportId}?e=${seconds}&s=${signature}`,
    expiresAt,
    signature,
  };
}

export type LinkCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "expired" | "invalid" };

/**
 * Verify a link.
 *
 * Expiry is checked **after** the signature, so a forged token with a
 * far-future expiry is reported as invalid rather than as expired — the
 * difference tells the person holding a real, lapsed link that asking for a
 * fresh one will work.
 */
export function verifyReportLink(
  reportId: string,
  expiresAtSeconds: number,
  signature: string,
  secret: string,
  now: Date = new Date(),
): LinkCheck {
  if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= 0) {
    return { ok: false, reason: "invalid" };
  }

  const expected = Buffer.from(sign(reportId, Math.floor(expiresAtSeconds), secret));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "invalid" };
  }

  if (expiresAtSeconds * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function expiryFromNow(now: Date = new Date(), days: number = linkTtlDays()): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
