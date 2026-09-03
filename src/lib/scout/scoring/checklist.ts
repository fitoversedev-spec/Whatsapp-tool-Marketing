/**
 * The surveyor checklist — defined **here, once**.
 *
 * Phase 3 owns this definition and Phases 4, 5 and 6 render it generically.
 * Two UI phases hand-rolling their own copies would drift within a sprint, and
 * a drifted label on a printed report is a number the salesperson cannot
 * explain. Import `SURVEYOR_CHECKLIST` and iterate it; never restate a field.
 *
 * The content is the client's D6 answer, verbatim (`plan/CLIENT-INPUTS.md`
 * → *D6 · Surveyor checklist*): fourteen fields in four groups, each rated
 * 0–3, together worth 15 of the 100 points.
 *
 * ## What is *not* here
 *
 * Weights and hard flags. Those are score-model data, loaded from the
 * `score_models` row, because the client may change which fields are
 * make-or-break without changing what the fields *are*. A field definition is
 * a question put to a surveyor; a weight is a modelling decision. They version
 * separately.
 *
 * ## Ids are persisted
 *
 * `scans.surveyor_inputs` is keyed by these ids. Renaming one orphans every
 * survey already recorded — change a `label`, never an `id`. A test pins the
 * current set.
 */

/** The four groups the client organised the checklist into. */
export type ChecklistGroupId =
  | "access-commercial"
  | "utilities"
  | "land-condition"
  | "neighbours-restrictions";

export interface ChecklistGroupDef {
  readonly id: ChecklistGroupId;
  readonly label: string;
  /** One line explaining what the group is for, for the survey screen header. */
  readonly description: string;
}

export interface ChecklistFieldDef {
  /** Stable id. Persisted in `scans.surveyor_inputs` — never rename. */
  readonly id: string;
  readonly group: ChecklistGroupId;
  readonly label: string;
  /** Shown under the label on the survey form. Written for someone standing on the plot. */
  readonly help: string;
  /**
   * The 0–3 anchors, in order. Index is the rating. Rendering these rather
   * than a bare 0–3 slider is what makes two surveyors score the same plot
   * alike, so the UI must show them.
   */
  readonly anchors: readonly [string, string, string, string];
}

/** Bumped when a field is added, removed, or its anchors change meaning. */
export const CHECKLIST_VERSION = "1.0.0";

export const CHECKLIST_GROUPS: readonly ChecklistGroupDef[] = [
  {
    id: "access-commercial",
    label: "Access & commercial",
    description: "Can customers find the site, reach it and park at it?",
  },
  {
    id: "utilities",
    label: "Utilities",
    description: "What has to be brought to the plot before anything can be built on it.",
  },
  {
    id: "land-condition",
    label: "Land condition",
    description: "What the ground itself will cost to make playable.",
  },
  {
    id: "neighbours-restrictions",
    label: "Neighbours & restrictions",
    description: "What the surroundings will let the facility do, and when.",
  },
] as const;

export const SURVEYOR_CHECKLIST: readonly ChecklistFieldDef[] = [
  /* ------------------------------------------- access & commercial (5) */
  {
    id: "road-frontage",
    group: "access-commercial",
    label: "Road frontage",
    help: "How much of the plot's boundary meets a usable road.",
    anchors: [
      "None — rear access only",
      "Narrow lane",
      "One side, adequate",
      "Wide frontage on a main road",
    ],
  },
  {
    id: "parking",
    group: "access-commercial",
    label: "Parking",
    help: "Where a car or two-wheeler goes during a 7 pm slot.",
    anchors: [
      "None possible",
      "Street only, congested",
      "Some off-street space",
      "Dedicated space available",
    ],
  },
  {
    id: "visibility",
    group: "access-commercial",
    label: "Visibility",
    help: "Whether a passer-by would ever know the facility is there.",
    anchors: [
      "Hidden",
      "Visible up close only",
      "Visible from a side road",
      "Visible from a main road",
    ],
  },
  {
    id: "approach-road",
    group: "access-commercial",
    label: "Approach road",
    help: "The condition of the last few hundred metres.",
    anchors: [
      "Unmade or very poor",
      "Single-width, poor",
      "Two-way, adequate",
      "Wide and in good condition",
    ],
  },
  {
    id: "distance-to-transit",
    group: "access-commercial",
    label: "Distance to transit",
    help: "Walking distance to the nearest metro station or bus terminal.",
    anchors: ["Over 3 km", "2–3 km", "1–2 km", "Under 1 km"],
  },

  /* ------------------------------------------------------ utilities (3) */
  {
    id: "power-supply",
    group: "utilities",
    label: "Power supply",
    help: "Floodlights are the single largest electrical load a turf carries.",
    anchors: [
      "None nearby",
      "Needs a new connection",
      "Connection available",
      "Three-phase already on site",
    ],
  },
  {
    id: "water",
    group: "utilities",
    label: "Water",
    help: "Washrooms, drinking water and surface cleaning.",
    anchors: ["None", "Tanker only", "Borewell possible", "Municipal connection"],
  },
  {
    id: "drainage",
    group: "utilities",
    label: "Drainage",
    help: "Where rain goes. A turf that holds water loses every monsoon evening.",
    anchors: [
      "Standing water, or no drainage",
      "Poor — floods in rain",
      "Adequate",
      "Good, graded away from the plot",
    ],
  },

  /* ------------------------------------------------- land condition (4) */
  {
    id: "slope-levelling",
    group: "land-condition",
    label: "Slope / levelling",
    help: "Earthwork needed before a playing surface can be laid.",
    anchors: [
      "Major earthwork needed",
      "Significant levelling",
      "Minor levelling",
      "Already level",
    ],
  },
  {
    id: "soil-ground",
    group: "land-condition",
    label: "Soil / ground",
    help: "What the base will need under it.",
    anchors: ["Soft, needs treatment", "Some fill needed", "Firm", "Firm and compacted"],
  },
  {
    id: "flood-history",
    group: "land-condition",
    label: "Flood history",
    help: "Ask neighbours, not the owner.",
    anchors: [
      "Floods regularly",
      "Flooded in heavy rain",
      "Occasional waterlogging",
      "No known flooding",
    ],
  },
  {
    id: "boundary",
    group: "land-condition",
    label: "Boundary",
    help: "What already exists of the perimeter.",
    anchors: [
      "Open on all sides",
      "Partial fencing",
      "Walled, needs repair",
      "Walled with a gate",
    ],
  },

  /* ------------------------------------- neighbours & restrictions (2) */
  {
    id: "adjacent-residences",
    group: "neighbours-restrictions",
    label: "Adjacent residences",
    help: "Who will hear a floodlit match at 9 pm.",
    anchors: [
      "Homes on all sides",
      "Homes on two sides",
      "Homes on one side",
      "No immediate homes",
    ],
  },
  {
    id: "evening-play-restrictions",
    group: "neighbours-restrictions",
    label: "Evening play restrictions",
    help: "Any rule — society, local authority or informal — limiting play after dark. The 7–11 pm window is the highest-revenue part of the day.",
    anchors: [
      "Night play prohibited",
      "Restricted after 9 pm",
      "Some limits",
      "No restrictions",
    ],
  },
] as const;

/** The highest rating any field accepts. Ratings are integers in `0..MAX`. */
export const CHECKLIST_MAX_RATING = 3;

export const CHECKLIST_FIELD_IDS: readonly string[] = SURVEYOR_CHECKLIST.map((f) => f.id);

const FIELD_BY_ID = new Map(SURVEYOR_CHECKLIST.map((f) => [f.id, f]));

export function getChecklistField(id: string): ChecklistFieldDef | undefined {
  return FIELD_BY_ID.get(id);
}

/** Fields belonging to one group, in checklist order. */
export function checklistFieldsInGroup(group: ChecklistGroupId): ChecklistFieldDef[] {
  return SURVEYOR_CHECKLIST.filter((f) => f.group === group);
}

/**
 * Ratings a surveyor recorded, keyed by field id.
 *
 * Sparse on purpose: a field nobody answered is **absent**, never `0`. Zero is
 * the worst possible observation ("night play prohibited"); absence is no
 * observation at all. Collapsing the two is how an unsurveyed site would score
 * as a terrible one.
 */
export type SurveyorInputs = Readonly<Record<string, number>>;

/**
 * Keep only well-formed ratings for fields that still exist.
 *
 * Anything else — an unknown id from a renamed field, a `null`, a 7, a
 * fractional value — is dropped rather than clamped. A clamped value would be
 * scored as if a surveyor had entered it.
 */
export function sanitiseSurveyorInputs(raw: unknown): SurveyorInputs {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!FIELD_BY_ID.has(key)) continue;
    if (typeof value !== "number" || !Number.isInteger(value)) continue;
    if (value < 0 || value > CHECKLIST_MAX_RATING) continue;
    out[key] = value;
  }
  return out;
}
