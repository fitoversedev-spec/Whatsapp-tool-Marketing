/**
 * Which city a scan belongs to.
 *
 * Pure — no database, no environment.
 *
 * A benchmark is only meaningful if every scan behind it is genuinely in the
 * same city. Filing a Chennai scan under "Bengaluru" would corrupt the median
 * the report cites, so this resolver **refuses rather than guesses**: it returns
 * `null` whenever the city is not established, and a scan with no city
 * contributes to no benchmark at all.
 */

/**
 * Canonical names, keyed by the lowercase forms that should map to them.
 *
 * Only aliases that are unambiguous. "Bangalore" and "Bengaluru" are the same
 * place; a fuzzy matcher that folded "Salem" into "Selam" would not be.
 */
const CITY_ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  bengalooru: "Bengaluru",
  madras: "Chennai",
  chennai: "Chennai",
  bombay: "Mumbai",
  mumbai: "Mumbai",
  calcutta: "Kolkata",
  kolkata: "Kolkata",
  trichy: "Tiruchirappalli",
  tiruchirapalli: "Tiruchirappalli",
  tiruchirappalli: "Tiruchirappalli",
  coimbatore: "Coimbatore",
  madurai: "Madurai",
  salem: "Salem",
  tirunelveli: "Tirunelveli",
  erode: "Erode",
  vellore: "Vellore",
  thanjavur: "Thanjavur",
  hosur: "Hosur",
  mysore: "Mysuru",
  mysuru: "Mysuru",
  hyderabad: "Hyderabad",
  pune: "Pune",
  delhi: "Delhi",
};

/**
 * Cities we may recognise inside a free-text address.
 *
 * Deliberately a closed list. Matching an address against known city names is
 * safe; inferring a city from an unrecognised address is not, and an address in
 * India frequently names a locality, a district and a state with no consistent
 * ordering.
 */
export const KNOWN_CITIES: readonly string[] = Array.from(
  new Set(Object.values(CITY_ALIASES)),
).sort();

/** Canonical display name for a city, or `null` if it is not a usable name. */
export function canonicaliseCity(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) return null;

  const alias = CITY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  // Unknown but plausible city name — keep it, title-cased so "BENGALURU" and
  // "bengaluru" do not become two benchmark rows.
  return trimmed
    .toLowerCase()
    .split(" ")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Find a known city named inside a free-text address, on a word boundary. */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (typeof address !== "string" || !address.trim()) return null;
  const haystack = address.toLowerCase();

  for (const [alias, canonical] of Object.entries(CITY_ALIASES)) {
    const pattern = new RegExp(`(^|[^a-z])${alias}($|[^a-z])`, "i");
    if (pattern.test(haystack)) return canonical;
  }
  return null;
}

export interface ScanLocationFields {
  /** `sites.city`, when the scan is attached to a saved site. The best source. */
  siteCity?: string | null;
  /** `scans.address`. Searched only for names in `KNOWN_CITIES`. */
  address?: string | null;
}

/**
 * The city a scan should be benchmarked under, or `null`.
 *
 * `null` is a normal outcome, not an error. The scan simply does not contribute
 * to any city benchmark, and `recomputeCityBenchmarks` reports how many were
 * skipped this way so the gap is visible rather than silent.
 */
export function resolveScanCity(fields: ScanLocationFields): string | null {
  return canonicaliseCity(fields.siteCity) ?? cityFromAddress(fields.address);
}
