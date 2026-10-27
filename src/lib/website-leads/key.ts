// The shared secret that protects POST /api/website-leads/incoming. The website
// holds the full URL (`...?key=<secret>`); the CRM keeps only a sha256 hash of
// the secret, in the Setting table under WEBSITE_LEAD_KEY_SETTING.
//
// No database import here on purpose: scripts/website-lead-key.ts imports this
// file before it has checked DATABASE_URL, and loading Prisma first would let it
// pick up a .env file.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const WEBSITE_LEAD_KEY_SETTING = "website_lead_webhook_key_hash";
export const WEBSITE_LEAD_INCOMING_PATH = "/api/website-leads/incoming";

/** A fresh secret: 256 random bits, URL-safe. */
export function generateWebsiteLeadKey(): string {
  return `wlk_${randomBytes(32).toString("base64url")}`;
}

/** sha256 (hex) of a secret — what is stored. */
export function hashWebsiteLeadKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * True when `provided` hashes to `storedHash`. Missing or empty on either side is
 * false (no key issued yet = nothing is accepted). The two sha256 digests are
 * compared in constant time.
 */
export function keyMatchesHash(provided: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (!provided || !storedHash) return false;
  const a = Buffer.from(hashWebsiteLeadKey(provided), "hex");
  const b = Buffer.from(storedHash.trim(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
