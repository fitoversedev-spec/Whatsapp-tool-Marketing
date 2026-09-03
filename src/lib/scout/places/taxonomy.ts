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
    label: "Turf sports",
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
    id: "racquet-sports",
    label: "Racquet sports",
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
      {
        id: "tennis",
        label: "Tennis",
        mode: "text",
        queries: ["tennis court", "tennis academy"],
        sportFormat: "tennis",
      },
      {
        id: "badminton",
        label: "Badminton",
        mode: "text",
        queries: ["badminton court", "shuttle court", "badminton academy"],
        sportFormat: "badminton",
      },
      {
        id: "squash",
        label: "Squash",
        mode: "text",
        queries: ["squash court", "squash arena"],
        sportFormat: "squash",
      },
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
    id: "court-sports",
    label: "Court sports",
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
    id: "track-wheels",
    label: "Track & wheels",
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
      {
        id: "skating-rink",
        label: "Skating rink",
        // `ice_skating_rink` is the only skating type Google has, and Indian
        // rinks are overwhelmingly roller. Text mode catches both.
        mode: "text",
        queries: ["skating rink", "roller skating rink"],
        sportFormat: "skating-rink",
      },
    ],
  },
  {
    id: "water",
    label: "Water",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      {
        id: "swimming-pool",
        label: "Swimming pool",
        mode: "nearby",
        googleTypes: ["swimming_pool"],
        sportFormat: "swimming-pool",
      },
    ],
  },
  {
    id: "adjacent-fitness",
    label: "Adjacent fitness",
    side: "competition",
    fields: "ENTERPRISE_ATMOSPHERE",
    terms: [
      { id: "gym", label: "Gym", mode: "nearby", googleTypes: ["gym", "fitness_center"] },
      {
        id: "sports-academy",
        label: "Sports academy",
        mode: "nearby",
        googleTypes: ["sports_coaching", "sports_activity_location"],
      },
      {
        id: "sports-club",
        label: "Sports club",
        mode: "nearby",
        googleTypes: ["sports_club", "sports_complex"],
      },
    ],
  },
] as const;

/* ------------------------------------------------------------ demand side */

const DEMAND: readonly CategoryDef[] = [
  {
    id: "education",
    label: "Education",
    side: "demand",
    // Schools need a name, a location and a type. Nothing pricier.
    fields: "PRO",
    anchorWeight: 0.7,
    terms: [
      {
        id: "school",
        label: "Schools",
        mode: "nearby",
        googleTypes: ["school", "primary_school", "secondary_school"],
      },
      { id: "international-school", label: "International schools", mode: "text", queries: ["international school"] },
      { id: "college", label: "Colleges", mode: "text", queries: ["college"] },
      { id: "university", label: "Universities", mode: "nearby", googleTypes: ["university"] },
    ],
  },
  {
    id: "workplaces",
    label: "Workplaces",
    side: "demand",
    fields: "PRO",
    anchorWeight: 1.0,
    terms: [
      { id: "tech-park", label: "Tech parks", mode: "text", queries: ["tech park", "IT park"] },
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
    id: "residential",
    label: "Residential",
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
      {
        id: "gated-community",
        label: "Gated communities",
        mode: "text",
        queries: ["gated community"],
      },
      { id: "hostel", label: "Hostels", mode: "nearby", googleTypes: ["hostel"] },
    ],
  },
  {
    id: "lifestyle",
    label: "Lifestyle",
    side: "demand",
    // `priceLevel` is the free affluence proxy (plan §3) and is an Enterprise
    // field, so this one category costs a tier more than the other anchors.
    fields: "ENTERPRISE",
    anchorWeight: 0.2,
    terms: [
      { id: "cafe", label: "Cafés", mode: "nearby", googleTypes: ["cafe"] },
      { id: "restaurant", label: "Restaurants", mode: "nearby", googleTypes: ["restaurant"] },
      { id: "mall", label: "Malls", mode: "nearby", googleTypes: ["shopping_mall"] },
      { id: "hotel", label: "Hotels", mode: "nearby", googleTypes: ["hotel"] },
    ],
  },
  {
    id: "transit",
    label: "Transit",
    side: "demand",
    fields: "PRO",
    anchorWeight: 0.4,
    terms: [
      {
        id: "metro-station",
        label: "Metro stations",
        mode: "nearby",
        googleTypes: ["subway_station", "light_rail_station"],
      },
      {
        id: "bus-terminal",
        label: "Bus terminals",
        mode: "nearby",
        googleTypes: ["bus_station"],
      },
    ],
  },
] as const;

export const CATEGORIES: readonly CategoryDef[] = [...COMPETITION, ...DEMAND];

export const PRESETS: readonly PresetDef[] = [
  {
    id: "quick-check",
    label: "Quick check",
    description: "Turf sports and education. The cheapest useful read on a plot.",
    categoryIds: ["turf-sports", "education"],
  },
  {
    id: "standard-scan",
    label: "Standard scan",
    description: "The three formats Fitoverse sells most, against the three demand pools that fill them.",
    categoryIds: ["turf-sports", "racquet-sports", "cricket", "education", "workplaces", "residential"],
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
