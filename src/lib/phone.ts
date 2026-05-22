// Phone number normalization to E.164 without leading + (Meta format).

const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || "91"; // India default

export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[\s\-()]/g, "").trim();
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+$/.test(s)) return null;
  // Strip leading zero(s) — common in local Indian format (0xxxxxxxxxx)
  s = s.replace(/^0+/, "");
  if (s.length < 7) return null;
  if (s.length === 10) s = DEFAULT_COUNTRY_CODE + s;
  if (s.length > 15) return null;
  return s;
}

// Combine a separate country-code column with a local phone column.
// Strips leading zeros from the local part so "91" + "08015910405" -> "918015910405".
export function combinePhone(countryCode: string, localPart: string): string {
  const cc = String(countryCode ?? "").replace(/\D/g, "");
  const local = String(localPart ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return cc + local;
}

export function isValidE164(s: string): boolean {
  return /^\d{7,15}$/.test(s);
}

// Parse a spreadsheet truthy/falsy cell into a boolean.
// "TRUE", "true", "1", "yes", "y" -> true ; "FALSE", "0", "no", "" -> false
export function parseBool(value: unknown, defaultValue = true): boolean {
  if (value === null || value === undefined || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return defaultValue;
}
