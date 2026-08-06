// Maps Meta lead-gen Instant-Form answers to our normalized analytics fields.
// Form question `name` keys vary per form (city vs town vs location; sport vs
// which_sport vs interest), so we match against alias sets rather than one key.
// Extraction runs at ingest (leads.ts) so city/sport become real columns the
// analytics can group on — fieldData is a plain String and can't be queried in
// SQL. A form-specific override could later be layered in via a Setting key.

import type { MetaLeadFieldDatum } from "./client";

// Lowercased aliases; a field matches if its `name` equals or contains one.
const CITY_ALIASES = ["city", "town", "location", "place", "area", "district"];
const SPORT_ALIASES = [
  "which_sport",
  "which sport",
  "interested_sport",
  "sport_interested",
  "sport",
  "sports",
  "game",
  "interest",
];

function findByAlias(fieldData: MetaLeadFieldDatum[], aliases: string[]): string | null {
  for (const f of fieldData) {
    const name = (f.name ?? "").toLowerCase().trim();
    if (!name) continue;
    if (aliases.some((a) => name === a || name.includes(a))) {
      const v = f.values?.[0];
      if (v && v.trim()) return v.trim();
    }
  }
  return null;
}

/** Raw (trimmed) city as the lead typed it — preserves the original for display. */
export function extractCity(fieldData: MetaLeadFieldDatum[]): string | null {
  return findByAlias(fieldData, CITY_ALIASES);
}

/** Raw (trimmed) sport as the lead selected/typed it. */
export function extractSport(fieldData: MetaLeadFieldDatum[]): string | null {
  return findByAlias(fieldData, SPORT_ALIASES);
}

/** Title-case a free-text value so analytics groups "salem"/"SALEM"/"Salem" together. */
export function normalizeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const c = value.trim().replace(/\s+/g, " ");
  if (!c) return null;
  return c
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export type ParsedField = { name: string; value: string };

/**
 * Parse the stored fieldData JSON string back into name/value pairs. Server-side
 * twin of the client parseFieldData — tolerant of both Meta's [{name,values}]
 * array shape and a plain {key: value} object.
 */
export function parseFieldDataJson(json: string | null | undefined): ParsedField[] {
  if (!json) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (Array.isArray(data)) {
    return data
      .map((f) => {
        const o = (f ?? {}) as { name?: unknown; values?: unknown[]; value?: unknown };
        const value = Array.isArray(o.values) ? o.values[0] : o.value;
        return { name: String(o.name ?? ""), value: String(value ?? "") };
      })
      .filter((f) => f.name);
  }
  if (data && typeof data === "object") {
    return Object.entries(data as Record<string, unknown>).map(([name, value]) => ({
      name,
      value: String(value ?? ""),
    }));
  }
  return [];
}
