/**
 * What a surveyor records about a **competitor**, standing outside it.
 *
 * ## Why this exists at all
 *
 * The phone mockup's competitor screen prints `Pay and play · ₹1,200/hr`, a
 * court count of "2 five-a-side", a flooring type and an indoor/outdoor
 * setting. **Google supplies none of those.** Places returns a rating, a review
 * count, opening hours, a price *level* (0–4, and only on Enterprise-tier
 * fetches), a website and a phone number — and nothing about the surface a
 * facility is laid on or what it charges per hour.
 *
 * So either the screen shows made-up numbers, or a person standing in front of
 * the venue types them in. This is the definition of what they type.
 *
 * ## Observed vs entered
 *
 * Screen 03 must make the distinction visible, because the two have completely
 * different reliability: a rating of 4.4 is a fact about 312 strangers'
 * opinions, and "₹1,200/hr" is one salesperson's recollection of a board on a
 * gate. Every field here is `entered`. Everything from `ScanResultPlace` is
 * `observed`.
 *
 * ## Ids are persisted
 *
 * These become `place_tags.key`. Renaming one orphans every observation already
 * recorded against it — change a `label`, never an `id`. No migration is
 * involved: `place_tags` is Phase 0's key/value table, unique on
 * `(place_id, key)`, and it exists for precisely this.
 *
 * Pure: no database, no framework, no network. Both the API route and the
 * client form import it.
 */

export type VenueFieldKind = "choice" | "text" | "currency";

export interface VenueFieldDef {
  /** Stable id. Persisted as `place_tags.key` — never rename. */
  readonly id: string;
  readonly label: string;
  /** Written for someone standing at the gate. */
  readonly help: string;
  readonly kind: VenueFieldKind;
  /** For `choice`. The first entry is always the "not recorded" state. */
  readonly options?: readonly string[];
  readonly placeholder?: string;
  /** For `currency`, in whole rupees. */
  readonly max?: number;
}

/** Bumped when a field is added or removed. */
export const VENUE_SURVEY_VERSION = "1.0.0";

export const VENUE_SURVEY_FIELDS: readonly VenueFieldDef[] = [
  {
    id: "flooring",
    label: "Flooring",
    help: "The playing surface as laid, not as advertised.",
    kind: "choice",
    options: ["Turf", "Acrylic", "PU", "Concrete", "Wooden", "Clay", "Natural grass", "Other"],
  },
  {
    id: "setting",
    label: "Setting",
    help: "Whether play stops when it rains.",
    kind: "choice",
    options: ["Outdoor", "Covered", "Indoor", "Rooftop"],
  },
  {
    id: "courts",
    label: "Courts",
    help: 'How many playing areas, and of what size — e.g. "2 five-a-side".',
    kind: "text",
    placeholder: "2 five-a-side",
  },
  {
    id: "pay-and-play",
    label: "Pay and play",
    help: "Whether a walk-in can book a slot, or it is members only.",
    kind: "choice",
    options: ["Yes", "Members only", "Coaching only"],
  },
  {
    id: "hourly-price-inr",
    label: "Hourly price",
    help: "Peak-hour rate in rupees, as posted at the venue.",
    kind: "currency",
    placeholder: "1200",
    max: 1_000_000,
  },
] as const;

export const VENUE_FIELD_IDS: readonly string[] = VENUE_SURVEY_FIELDS.map((f) => f.id);

const FIELD_BY_ID = new Map(VENUE_SURVEY_FIELDS.map((f) => [f.id, f]));

export function getVenueField(id: string): VenueFieldDef | undefined {
  return FIELD_BY_ID.get(id);
}

/** Values keyed by field id. Sparse: an unrecorded field is absent. */
export type VenueSurveyValues = Readonly<Record<string, string>>;

/**
 * Keep only well-formed values for fields that still exist.
 *
 * Follows the same rule as the surveyor checklist: anything malformed is
 * **dropped, not repaired**. A choice value that is not one of the options was
 * either a client bug or a renamed option, and storing it would put a string
 * on a printed spec table that nobody chose. An empty string clears the field
 * — that is how a surveyor un-records a mistake.
 */
export function sanitiseVenueSurvey(raw: unknown): {
  values: Record<string, string>;
  rejected: string[];
} {
  const values: Record<string, string> = {};
  const rejected: string[] = [];
  if (!raw || typeof raw !== "object") return { values, rejected };

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = FIELD_BY_ID.get(key);
    if (!field) {
      rejected.push(key);
      continue;
    }
    if (value === null || value === "") {
      values[key] = "";
      continue;
    }
    if (typeof value !== "string") {
      rejected.push(key);
      continue;
    }

    const trimmed = value.trim();
    if (trimmed === "") {
      values[key] = "";
      continue;
    }

    if (field.kind === "choice") {
      if (!field.options?.includes(trimmed)) {
        rejected.push(key);
        continue;
      }
      values[key] = trimmed;
      continue;
    }

    if (field.kind === "currency") {
      const digits = trimmed.replace(/[,\s₹]/g, "");
      const amount = Number(digits);
      if (!Number.isInteger(amount) || amount < 0 || amount > (field.max ?? 1_000_000)) {
        rejected.push(key);
        continue;
      }
      values[key] = String(amount);
      continue;
    }

    if (trimmed.length > 120) {
      rejected.push(key);
      continue;
    }
    values[key] = trimmed;
  }

  return { values, rejected };
}

/**
 * The mockup's "Pay and play" cell: `Yes · ₹1,200/hr`, or just the flag when no
 * price was recorded. Returns `null` when neither was.
 */
export function payAndPlayLabel(values: VenueSurveyValues): string | null {
  const flag = values["pay-and-play"];
  const price = values["hourly-price-inr"];
  const priceLabel = price ? `₹${Number(price).toLocaleString("en-IN")}/hr` : null;
  if (flag && priceLabel) return `${flag} · ${priceLabel}`;
  return flag || priceLabel || null;
}
