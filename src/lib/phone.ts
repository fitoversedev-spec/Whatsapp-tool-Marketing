// Phone number normalization to E.164 without leading + (Meta format).
// Default country code applied if number looks local.

const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || "91"; // India default

export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s\-()]/g, "").trim();
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+$/.test(s)) return null;
  if (s.length < 7) return null;
  if (s.length === 10) s = DEFAULT_COUNTRY_CODE + s;
  if (s.length > 15) return null;
  return s;
}

export function isValidE164(s: string): boolean {
  return /^\d{7,15}$/.test(s);
}
