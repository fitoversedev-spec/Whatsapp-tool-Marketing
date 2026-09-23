import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_DAYS = 90;

function ttlDays(): number {
  const raw = Number(process.env.INSIGHT_LINK_TTL_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_DAYS;
  return Math.min(Math.floor(raw), 365 * 5);
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function linkSecret(): string {
  const dedicated = process.env.REPORT_LINK_SECRET?.trim();
  if (dedicated && dedicated.length >= 32) return dedicated;
  const auth = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
  if (!auth || auth.length < 32)
    throw new Error("AUTH_SECRET must be at least 32 characters");
  return auth;
}

function sign(docId: string, expiresAtSeconds: number): string {
  return base64url(
    createHmac("sha256", linkSecret())
      .update(`insight:${docId}:${expiresAtSeconds}`)
      .digest(),
  );
}

export interface SignedInsightLink {
  readonly path: string;
  readonly fullUrl: string;
  readonly expiresAt: Date;
}

function appUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function signInsightLink(docId: string): SignedInsightLink {
  const expiresAt = new Date(Date.now() + ttlDays() * 86_400_000);
  const seconds = Math.floor(expiresAt.getTime() / 1000);
  const s = sign(docId, seconds);
  const path = `/i/${docId}?e=${seconds}&s=${s}`;
  return { path, fullUrl: `${appUrl()}${path}`, expiresAt };
}

export function signInsightPdfLink(docId: string): string {
  const expiresAt = new Date(Date.now() + ttlDays() * 86_400_000);
  const seconds = Math.floor(expiresAt.getTime() / 1000);
  const s = sign(docId, seconds);
  return `${appUrl()}/i/${docId}/pdf?e=${seconds}&s=${s}`;
}

export type LinkCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "expired" | "invalid" };

export function verifyInsightLink(
  docId: string,
  expiresAtSeconds: number,
  signature: string,
): LinkCheck {
  if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= 0) {
    return { ok: false, reason: "invalid" };
  }
  const expected = Buffer.from(sign(docId, Math.floor(expiresAtSeconds)));
  const provided = Buffer.from(signature);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (expiresAtSeconds * 1000 <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}
