/**
 * The scoring contract: what goes in, what comes out.
 *
 * Deliberately independent of `ScanResult`. The scoring module accepts a plain
 * structure it fully owns, and the server-side adapter maps a scan onto it.
 * That is what keeps `src/lib/scoring/**` free of database, network and
 * framework imports — a property a test enforces, because the moment scoring
 * can reach a database it stops being reproducible.
 *
 * ## The rule every type here exists to serve
 *
 * Every point traces to a number printed elsewhere in the same report. So each
 * component carries not just its points but the raw inputs it used and a
 * one-sentence justification citing them. A salesperson reads the
 * justification across a table; the raw inputs are what they point at when
 * asked "where does 6.3 come from?".
 *
 * ## What no string in here may ever imply
 *
 * Population, density or per-capita anything. Model v1.0 has no population
 * data (`docs/PHASE-2-HANDOFF.md`), and a land owner acting on a fabricated
 * population figure is the worst failure this project can produce.
 * `noPopulationClaims.test.ts` asserts the absence of those terms across every
 * string this module can emit.
 */

import type { SurveyorInputs } from "./checklist";

export type ComponentId =
  | "demand-anchors"
  | "competitive-saturation"
  | "market-proof"
  | "service-gap"
  | "site-practicals";

export type Verdict = "proceed" | "investigate" | "avoid";

export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Whether a surveyor visited.
 *
 * `desk_only` means component 5 was excluded and the remaining 85 points were
 * rescaled to 100. That is the correct treatment of *unknown* — an unsurveyed
 * site is not a bad site — but it makes the two numbers **non-comparable**: an
 * unsurveyed plot can outrank a surveyed one purely by having no observations,
 * and the dashboard sorts by score. So the flag is not advisory. A `desk_only`
 * score must be labelled everywhere it appears and must never be silently
 * ranked against a `full` one.
 */
export type ScoreBasis = "full" | "desk_only";

export type FlagSeverity = "info" | "warning" | "hard";

export interface ScoreFlag {
  /** Stable machine id — the UI keys off this, not the message. */
  readonly code: string;
  readonly severity: FlagSeverity;
  /** One sentence, printable as-is. */
  readonly message: string;
  /** Component that raised it, or `null` for a whole-score flag. */
  readonly component: ComponentId | null;
}

/**
 * A named row inside a component.
 *
 * Two shapes share it. Where a component splits its budget — component 4 does,
 * four ways — `available` is that part's share of the points. Where the rows
 * are *contributions* rather than allocations, as in component 1's anchor
 * table, `available` is `null`: those rows add up to the component's raw
 * input, not to its points, and printing a denominator against them would
 * invite the reader to add up numbers that were never meant to sum.
 */
export interface ComponentPart {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  readonly available: number | null;
  readonly detail: string;
}

export interface ComponentScore {
  readonly id: ComponentId;
  readonly label: string;
  /** Points awarded, rounded to 2 dp. */
  readonly points: number;
  /** Points this component can award. */
  readonly available: number;
  /**
   * `false` when the component could not be scored at all and was excluded
   * from both the numerator and the denominator — never scored as zero.
   * Component 5 with no survey is the only case in model v1.0.
   */
  readonly included: boolean;
  /**
   * The raw numbers the points were computed from, exactly as the
   * justification cites them. This is the audit trail.
   */
  readonly inputs: Readonly<Record<string, number | string | boolean | null>>;
  /** One sentence, plain English, citing its own numbers. Printable as-is. */
  readonly justification: string;
  readonly parts: readonly ComponentPart[];
  readonly flags: readonly ScoreFlag[];
}

/* --------------------------------------------------------------- inputs */

/**
 * One place from the scan, reduced to what scoring needs.
 *
 * `rating`, `reviewCount` and `priceLevel` are `null` when Google did not
 * supply them — **never zero**. A Pro-tier search returns no rating, and
 * coercing that to 0 would drag every catchment average down.
 */
export interface ScoreInputPlace {
  readonly placeId: string;
  readonly name: string;
  readonly side: "competition" | "demand";
  /** Every category that matched. A venue can be in more than one. */
  readonly categories: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly distanceM: number;
  readonly rating: number | null;
  readonly reviewCount: number | null;
  /** `OPERATIONAL`, `CLOSED_TEMPORARILY`, … or `null` when not fetched. */
  readonly businessStatus: string | null;
}

/** A competition term the scan actually searched for, and its sport format. */
export interface ScannedFormat {
  readonly termId: string;
  readonly label: string;
  readonly sportFormat: string;
}

/**
 * The city benchmark, reduced to the two figures the score cites.
 *
 * `sampleCount` travels with it because it is part of the claim: a median from
 * three scans is a guess, from forty it is data, and the justification says
 * which.
 */
export interface ScoreBenchmark {
  readonly city: string;
  readonly anchorsPerFacility: number | null;
  readonly medianRating: number | null;
  readonly sampleCount: number;
}

export type ThemeSentiment = "negative" | "neutral" | "positive";

/** One extracted theme, aggregated per competitor. */
export interface ScoreReviewTheme {
  readonly placeId: string;
  readonly theme: string;
  readonly sentiment: ThemeSentiment;
  readonly mentionCount: number;
}

export interface ScoreInput {
  readonly scanId: string | null;
  readonly areaLabel: string;
  readonly radiusM: number;
  /** Resolved city, for the benchmark. `null` when it could not be resolved. */
  readonly city: string | null;

  readonly places: readonly ScoreInputPlace[];
  /** Competition terms the scan searched, so "demand but no supply" is provable. */
  readonly scannedFormats: readonly ScannedFormat[];

  /** Any term truncated anywhere: no count may then be stated as exact. */
  readonly anySaturated: boolean;
  readonly saturatedTermLabels: readonly string[];

  readonly benchmark: ScoreBenchmark | null;

  readonly reviewThemes: readonly ScoreReviewTheme[];
  /**
   * Whether theme extraction has run for this scan. `false` means "not yet
   * analysed" and scores the complaint-theme part at zero **with a flag** —
   * distinct from "analysed, nothing found".
   */
  readonly themesExtracted: boolean;

  /** Sparse. An unanswered field is absent, never zero. */
  readonly surveyor: SurveyorInputs | null;

  /** `false` in every scan of this build. Recorded so v2.0 can branch on it. */
  readonly populationAvailable: boolean;
}

/* --------------------------------------------------------------- output */

export interface ConfidenceResult {
  readonly level: ConfidenceLevel;
  /** Penalties accumulated. 0 → high. Printed nowhere; used for ordering. */
  readonly penalty: number;
  /** Plain-English reasons, printable as a bullet list. */
  readonly reasons: readonly string[];
}

export interface ScoreResult {
  /** 0–100, 2 dp. Rescaled when a component was excluded — see `basis`. */
  readonly total: number;
  /** The same number as an integer, for headline display. */
  readonly totalRounded: number;
  readonly verdict: Verdict;
  /** Advisory wording. Never states or implies a financial return. */
  readonly verdictStatement: string;
  /**
   * `desk_only` when no site survey was recorded. **Must be shown wherever
   * the score is shown**, and must never be silently ranked against `full`.
   */
  readonly basis: ScoreBasis;
  /** The label the UI prints next to a score. Empty string when `full`. */
  readonly basisLabel: string;

  readonly components: readonly ComponentScore[];
  /** Points actually available after exclusions — 85 for a desk-only score. */
  readonly pointsAvailable: number;
  /** Points awarded before rescaling. */
  readonly pointsAwarded: number;

  readonly confidence: ConfidenceResult;
  /** Every flag from every component, plus whole-score flags. */
  readonly flags: readonly ScoreFlag[];
  /** Flags with severity `hard` — surfaced regardless of the total. */
  readonly hardFlags: readonly ScoreFlag[];

  readonly modelVersion: string;
  readonly checklistVersion: string;
  /** Counts as they must be printed: "at least N" when saturated. */
  readonly countsAreExact: boolean;
}
