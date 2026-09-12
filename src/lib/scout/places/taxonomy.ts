/**
 * The scan taxonomy — the one place categories, terms and presets are defined.
 *
 * The client asked for a category picker with presets, not a free-text term
 * box (`plan/CLIENT-INPUTS.md` → *Scan categories*). Phases 4 and 5 render this
 * structure generically, so **adding a sport later is an edit to this file and
 * nothing else** — no component change, no migration, no API change.
 *
 * Three things every entry carries, and why:
 *
 * - **`mode`** — `"nearby"` when Google has a real place type for the thing
 *   (`school`, `gym`, `swimming_pool`). Nearby Search takes a circular
 *   `locationRestriction`, which is a hard boundary, so results are already
 *   inside the tile. `"text"` for fuzzy Indian-market terms Google has no type
 *   for ("box cricket", "pickleball court"); Text Search takes only a
 *   rectangle, so those results need distance filtering afterwards.
 *
 * - **`fields`** — the SKU tier the search call is billed at, which is decided
 *   purely by the field mask we send. Competition needs `reviews` (score
 *   component 3 is built from review volume) and therefore pays Enterprise +
 *   Atmosphere. Most demand anchors need only a name and a location, so they
 *   pay Pro. Declaring the tier per category is what keeps a Full sweep from
 *   costing Atmosphere prices on all 33 terms.
 *
 * - **`side`** — which half of the score model the category feeds. Competition
 *   is supply; demand is the anchor pool.
 *
 * Google type strings below were checked against Table A of the live Places
 * API (New) documentation on 18 Aug 2026. `cricket_ground` does **not** exist,
 * which is why cricket is a text-mode category.
 */

/** Which half of the model a category feeds. */
export type Side = "competition" | "demand";

/** Which Places endpoint answers a term. */
export type SearchMode = "nearby" | "text";

/**
 * Places API (New) billing tier, set by the field mask. Highest tier among the
 * requested fields wins, so the mask and this value must agree — see
 * `fieldMasks.ts`, which derives one from the other.
 */
export type SkuTier = "ESSENTIALS" | "PRO" | "ENTERPRISE" | "ENTERPRISE_ATMOSPHERE";

export interface SearchTermDef {
  /** Stable id. Persisted in `scans.search_terms` and `scan_places.matched_terms` — never rename. */
  readonly id: string;
  /** Shown in the progress line: "Searching football turf… (3 of 8)". */
  readonly label: string;
  readonly mode: SearchMode;
  /**
   * Google Table A place types for `searchNearby.includedTypes`.
   * Required when `mode` is `"nearby"`, absent otherwise.
   */
  readonly googleTypes?: readonly string[];
  /**
   * Literal `textQuery` strings for `searchText`. Each one is a separate
   * billable sweep of every tile, so keep these tight.
   * Required when `mode` is `"text"`, absent otherwise.
   */
  readonly queries?: readonly string[];
  /**
   * Sport format this term maps to, where it maps to one. Phase 3 uses it for
   * the "demand but zero supply" check; `undefined` means the term is not a
   * playable format (a gym, a school).
   */
  readonly sportFormat?: string;
}

export interface CategoryDef {
  /** Stable id. Persisted in `scan_places.categories` — never rename. */
  readonly id: string;
  readonly label: string;
  readonly side: Side;
  /** SKU tier every search call for this category is billed at. */
  readonly fields: SkuTier;
  /**
   * Phase 3's demand-anchor weight (IMPLEMENTATION-PLAN §4). Present on demand
   * categories only. Phase 1 stores it; it computes nothing with it.
   */
  readonly anchorWeight?: number;
  readonly terms: readonly SearchTermDef[];
}

export interface PresetDef {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly categoryIds: readonly string[];
}

/* ------------------------------------------------------- competition side */

const COMPETITION: readonly CategoryDef[] = [
  {
    id: "turf-sports",
    label: "Football turfs",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "football-turf-5s",
        label: "Football turf (5-a-side)",
        mode: "text",
        queries: ["football turf", "box football", "5s turf"],
        sportFormat: "football-turf-5s",
      },
      {
        id: "football-turf-7s",
        label: "Football turf (7-a-side)",
        mode: "text",
        queries: ["7s turf", "football ground"],
        sportFormat: "football-turf-7s",
      },
    ],
  },
  {
    id: "badminton",
    label: "Badminton",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "badminton",
        label: "Badminton",
        mode: "text",
        queries: ["badminton court", "shuttle court", "badminton academy"],
        sportFormat: "badminton",
      },
    ],
  },
  {
    id: "tennis",
    label: "Tennis",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "tennis",
        label: "Tennis",
        mode: "text",
        queries: ["tennis court", "tennis academy"],
        sportFormat: "tennis",
      },
    ],
  },
  {
    id: "pickleball",
    label: "Pickleball",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "pickleball",
        label: "Pickleball",
        mode: "text",
        queries: ["pickleball court", "pickleball arena"],
        sportFormat: "pickleball",
      },
    ],
  },
  {
    id: "squash",
    label: "Squash",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "squash",
        label: "Squash",
        mode: "text",
        queries: ["squash court", "squash arena"],
        sportFormat: "squash",
      },
    ],
  },
  {
    id: "table-tennis",
    label: "Table tennis",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "table-tennis",
        label: "Table tennis",
        mode: "text",
        queries: ["table tennis academy", "TT academy"],
        sportFormat: "table-tennis",
      },
    ],
  },
  {
    id: "basketball",
    label: "Basketball",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "basketball",
        label: "Basketball",
        mode: "text",
        queries: ["basketball court", "basketball arena"],
        sportFormat: "basketball",
      },
    ],
  },
  {
    id: "volleyball",
    label: "Volleyball",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "volleyball",
        label: "Volleyball",
        mode: "text",
        queries: ["volleyball court"],
        sportFormat: "volleyball",
      },
    ],
  },
  {
    id: "cricket",
    label: "Cricket",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "box-cricket",
        label: "Box cricket",
        mode: "text",
        // Google has no `cricket_ground` type — verified against Table A.
        queries: ["box cricket", "box cricket arena"],
        sportFormat: "box-cricket",
      },
      {
        id: "cricket-nets",
        label: "Cricket nets",
        mode: "text",
        queries: ["cricket nets", "cricket practice nets"],
        sportFormat: "cricket-nets",
      },
    ],
  },
  {
    id: "running-track",
    label: "Running track",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "running-track",
        label: "Running track",
        mode: "nearby",
        googleTypes: ["athletic_field"],
        sportFormat: "running-track",
      },
    ],
  },
] as const;

/* ------------------------------------------------------------ demand side */

const DEMAND: readonly CategoryDef[] = [
  {
    id: "schools",
    label: "Schools",
    side: "demand",
    fields: "PRO",
    anchorWeight: 0.7,
    terms: [
      {
        id: "school",
        label: "Schools",
        mode: "nearby",
        googleTypes: ["school", "primary_school", "secondary_school"],
      },
    ],
  },
  {
    id: "colleges",
    label: "Colleges",
    side: "demand",
    fields: "PRO",
    anchorWeight: 0.7,
    terms: [
      {
        id: "college",
        label: "Colleges & Universities",
        mode: "nearby",
        googleTypes: ["university"],
      },
    ],
  },
  {
    id: "kindergarten",
    label: "Kindergarten",
    side: "demand",
    fields: "PRO",
    anchorWeight: 0.5,
    terms: [
      {
        id: "kindergarten",
        label: "Kindergarten & Preschools",
        mode: "text",
        queries: ["kindergarten", "preschool", "play school"],
      },
    ],
  },
  {
    id: "workplaces",
    label: "Workplaces",
    side: "demand",
    fields: "PRO",
    anchorWeight: 1.0,
    terms: [
      {
        id: "office-complex",
        label: "Office complexes",
        mode: "nearby",
        googleTypes: ["corporate_office"],
      },
      {
        id: "coworking",
        label: "Coworking spaces",
        mode: "nearby",
        googleTypes: ["coworking_space"],
      },
    ],
  },
  {
    id: "it-companies",
    label: "IT Companies",
    side: "demand",
    fields: "PRO",
    anchorWeight: 1.0,
    terms: [
      { id: "tech-park", label: "Tech parks", mode: "text", queries: ["tech park", "IT park"] },
      { id: "it-company", label: "IT companies", mode: "text", queries: ["IT company", "software company", "tech company"] },
    ],
  },
  {
    id: "apartments",
    label: "Apartments",
    side: "demand",
    fields: "PRO",
    anchorWeight: 0.8,
    terms: [
      {
        id: "apartment-complex",
        label: "Apartment complexes",
        mode: "nearby",
        googleTypes: ["apartment_complex", "apartment_building", "condominium_complex"],
      },
    ],
  },
] as const;

export const CATEGORIES: readonly CategoryDef[] = [...COMPETITION, ...DEMAND];

/**
 * Google `primaryType` values that are never a sports / activity facility.
 *
 * When a Text Search for "football turf" returns a general-contractor or a
 * wholesaler, it matched the keyword but not the intent. Filtering on
 * `primaryType` (the single most-specific type Google assigns) removes these
 * without risking legitimate venues whose secondary types overlap.
 *
 * Only checked for **competition** categories — demand categories either use
 * Nearby Search with explicit `includedTypes` (which already constrains) or
 * are intentionally broad (kindergarten, apartments).
 */
export const COMPETITION_DENY_TYPES: ReadonlySet<string> = new Set([
  // Construction & trades
  "general_contractor",
  "roofing_contractor",
  "electrician",
  "plumber",
  "painter",
  "locksmith",
  "moving_company",
  // Wholesale & distribution
  "wholesaler",
  // Retail
  "hardware_store",
  "clothing_store",
  "shoe_store",
  "jewelry_store",
  "electronics_store",
  "furniture_store",
  "home_goods_store",
  "department_store",
  "shopping_mall",
  "supermarket",
  "convenience_store",
  "pet_store",
  "book_store",
  // Professional services
  "accounting",
  "lawyer",
  "insurance_agency",
  "real_estate_agency",
  "travel_agency",
  "employment_agency",
  // Medical
  "hospital",
  "doctor",
  "dentist",
  "pharmacy",
  "veterinary_care",
  // Financial
  "bank",
  "atm",
  // Automotive
  "car_dealer",
  "car_rental",
  "car_repair",
  "car_wash",
  "gas_station",
  // Personal care
  "beauty_salon",
  "hair_care",
  "spa",
  "laundry",
  // Religious
  "church",
  "mosque",
  "hindu_temple",
  "synagogue",
  // Government & civic
  "city_hall",
  "courthouse",
  "fire_station",
  "police",
  "post_office",
  // Lodging
  "lodging",
  // Transit
  "airport",
  "bus_station",
  "train_station",
  "subway_station",
  // Funeral
  "funeral_home",
  "cemetery",
  // Food & drink
  "restaurant",
  "cafe",
  "bar",
  "bakery",
  "meal_delivery",
  "meal_takeaway",
  // Entertainment
  "movie_theater",
  "night_club",
  // Miscellaneous
  "parking",
  "storage",
  "courier_service",
]);

/**
 * Sport-keyword signals per competition category.
 *
 * Used to detect when a Google result clearly belongs to a *different* sport
 * than the one being searched. E.g. "Indiranagar Basketball Club" returned for
 * a "football turf" query — the name says basketball, not football.
 *
 * The check is two-step:
 *  1. If the place name matches the **target** category's keywords → keep it.
 *  2. If the name matches a **different** category's keywords → filter it.
 *  3. If the name matches no sport keywords at all → keep it (could be a
 *     multi-sport complex like "Sports Arena").
 */
const SPORT_NAME_SIGNALS: ReadonlyMap<string, readonly string[]> = new Map([
  ["table-tennis", ["table tennis", "ping pong"]],
  ["turf-sports", ["football", "futsal", "soccer", "turf"]],
  ["badminton", ["badminton", "shuttle"]],
  ["tennis", ["tennis"]],
  ["pickleball", ["pickleball"]],
  ["squash", ["squash"]],
  ["basketball", ["basketball"]],
  ["volleyball", ["volleyball"]],
  ["cricket", ["cricket"]],
  ["running-track", ["running track", "athletic track", "athletic field"]],
]);

function nameMatchesSport(lowerName: string, categoryId: string): boolean {
  const signals = SPORT_NAME_SIGNALS.get(categoryId);
  if (!signals) return false;
  if (categoryId === "tennis") {
    const stripped = lowerName.replace(/table\s+tennis/g, "");
    return stripped.includes("tennis");
  }
  return signals.some((kw) => lowerName.includes(kw));
}

export function isSportMismatch(placeName: string, categoryId: string): boolean {
  if (!SPORT_NAME_SIGNALS.has(categoryId)) return false;
  const lower = placeName.toLowerCase();
  if (nameMatchesSport(lower, categoryId)) return false;
  for (const [id] of SPORT_NAME_SIGNALS) {
    if (id === categoryId) continue;
    if (nameMatchesSport(lower, id)) return true;
  }
  return false;
}

export const PRESETS: readonly PresetDef[] = [
  {
    id: "quick-check",
    label: "Quick check",
    description: "Football turfs and schools. The cheapest useful read on a plot.",
    categoryIds: ["turf-sports", "schools"],
  },
  {
    id: "standard-scan",
    label: "Standard scan",
    description: "The three formats Fitoverse sells most, against the three demand pools that fill them.",
    categoryIds: ["turf-sports", "badminton", "tennis", "cricket", "schools", "colleges", "workplaces", "apartments"],
  },
  {
    id: "full-sweep",
    label: "Full sweep",
    description: "Every category. Roughly five times the cost of a Quick check — check the estimate first.",
    categoryIds: CATEGORIES.map((c) => c.id),
  },
] as const;

/* ------------------------------------------------------------- accessors */

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export function getCategory(id: string): CategoryDef | undefined {
  return BY_ID.get(id);
}

export function getPreset(id: string): PresetDef | undefined {
  return PRESET_BY_ID.get(id);
}

/** Category ids that exist, in taxonomy order, dropping unknown ids. */
export function resolveCategories(ids: readonly string[]): CategoryDef[] {
  const wanted = new Set(ids);
  return CATEGORIES.filter((c) => wanted.has(c.id));
}

/** Ids in `ids` that no longer exist — a scan saved before a taxonomy edit. */
export function unknownCategoryIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !BY_ID.has(id));
}

export function categoriesForPreset(presetId: string): CategoryDef[] {
  const preset = PRESET_BY_ID.get(presetId);
  return preset ? resolveCategories(preset.categoryIds) : [];
}

export interface ResolvedTerm {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly side: Side;
  readonly fields: SkuTier;
  readonly term: SearchTermDef;
}

/** Flatten a category selection into the term list the pipeline will execute. */
export function resolveTerms(categoryIds: readonly string[]): ResolvedTerm[] {
  return resolveCategories(categoryIds).flatMap((category) =>
    category.terms.map((term) => ({
      categoryId: category.id,
      categoryLabel: category.label,
      side: category.side,
      fields: category.fields,
      term,
    })),
  );
}

/** Every distinct sport format the taxonomy can detect. Phase 3 reads this. */
export function allSportFormats(): string[] {
  const formats = new Set<string>();
  for (const category of CATEGORIES) {
    for (const term of category.terms) {
      if (term.sportFormat) formats.add(term.sportFormat);
    }
  }
  return [...formats];
}

/**
 * The taxonomy shipped to the browser. It is deliberately the whole thing —
 * there is nothing secret in it, and Phases 4 and 5 need labels, presets and
 * term counts to render the picker and the live estimate.
 */
export function publicTaxonomy() {
  return {
    categories: CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      side: c.side,
      anchorWeight: c.anchorWeight,
      termCount: c.terms.length,
      terms: c.terms.map((t) => ({ id: t.id, label: t.label, sportFormat: t.sportFormat })),
    })),
    presets: PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      categoryIds: p.categoryIds,
    })),
  };
}
