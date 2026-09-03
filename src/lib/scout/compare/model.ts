/**
 * The comparison model — **pure**. No database, no React, no formatting of a
 * screen; just the table, the caveats and the sentence.
 *
 * ## Why the narrative is generated
 *
 * The mockup carries a fixed "Read" paragraph. A fixed paragraph is a lie the
 * moment the underlying scans change, and this screen exists to be shown to a
 * customer. Everything below is derived from the numbers in the same table, so
 * a reader can check every clause against the row above it.
 *
 * ## Why the warnings are not optional
 *
 * Three ways this table can mislead, all of them silent:
 *
 * 1. **Different radii.** A 5 km scan finds more of everything than a 2 km
 *    scan. Putting the two counts in adjacent columns without saying so is the
 *    single easiest way to pick the wrong area.
 * 2. **Different category sets.** A column that never searched for pickleball
 *    shows 0 pickleball courts, which reads identically to "we looked and
 *    there are none".
 * 3. **Mixed score bases.** A `desk_only` score is rescaled to 100 without the
 *    surveyor component, so an unvisited site can out-rank a visited one
 *    (`docs/PHASE-3-HANDOFF.md` §1).
 *
 * Each produces a warning with a stable `code`, so the UI keys off the code and
 * never off the wording.
 */

export type CompareDirection = "higher" | "lower" | "none";

export interface CompareSubject {
  readonly scanId: string;
  readonly areaLabel: string;
  readonly radiusM: number;
  /** Category ids the scan actually searched for. */
  readonly categoryIds: readonly string[];

  readonly facilityCount: number;
  readonly demandCount: number;
  readonly reviewTotal: number;
  readonly avgRating: number | null;
  /** Per-category place counts, keyed by category id. */
  readonly categoryCounts: Readonly<Record<string, number>>;
  /** Categories whose count is a floor because a tile truncated. */
  readonly saturatedCategoryIds: readonly string[];
  readonly anySaturated: boolean;

  readonly score: {
    readonly total: number;
    readonly verdict: "proceed" | "investigate" | "avoid";
    readonly basis: "full" | "desk_only";
    readonly confidence: "high" | "medium" | "low";
  } | null;

  /** Weighted demand anchors per Google-listed facility, from score component 2. */
  readonly anchorsPerFacility: number | null;
  readonly weightedAnchorTotal: number | null;
  readonly benchmarkAnchorsPerFacility: number | null;
  readonly benchmarkSampleCount: number;
  readonly benchmarkCity: string | null;
}

export interface CompareValue {
  /** Already carries the "at least" qualifier where a count was truncated. */
  readonly display: string;
  /** `null` when the subject has no figure — never 0 as a stand-in. */
  readonly numeric: number | null;
  /** True when this particular figure is a floor rather than a count. */
  readonly qualified: boolean;
}

export interface CompareRow {
  readonly id: string;
  readonly label: string;
  readonly direction: CompareDirection;
  readonly values: readonly CompareValue[];
  /** Index of the best column, or `null` when the row has no winner. */
  readonly bestIndex: number | null;
  /** Shown under the row label where the metric needs qualifying. */
  readonly note: string | null;
}

export interface CompareWarning {
  /** Stable machine id. Bind to this, never to the message. */
  readonly code: string;
  readonly severity: "warning" | "info";
  readonly message: string;
}

export interface ComparisonModel {
  readonly subjects: readonly CompareSubject[];
  readonly rows: readonly CompareRow[];
  readonly warnings: readonly CompareWarning[];
  /** The "Read" card, generated from the rows above it. */
  readonly narrative: readonly string[];
  /** True when any subject's counts are floors. */
  readonly anySaturated: boolean;
}

/* ------------------------------------------------------------ formatting */

function fmt(n: number, dp = 0): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function countValue(n: number, qualified: boolean): CompareValue {
  return { display: qualified ? `at least ${fmt(n)}` : fmt(n), numeric: n, qualified };
}

const ABSENT: CompareValue = { display: "—", numeric: null, qualified: false };

/**
 * Pick the winning column.
 *
 * Ties go to the first column, matching the mockup. A row where every value is
 * equal, or where fewer than two columns have a figure, has **no** winner —
 * highlighting a "best" among identical numbers is a claim about nothing.
 */
function pickBest(values: readonly CompareValue[], direction: CompareDirection): number | null {
  if (direction === "none") return null;
  const present = values
    .map((v, i) => ({ v: v.numeric, i }))
    .filter((e): e is { v: number; i: number } => e.v !== null);
  if (present.length < 2) return null;

  const allEqual = present.every((e) => e.v === present[0]?.v);
  if (allEqual) return null;

  let best = present[0]!;
  for (const entry of present) {
    if (direction === "higher" ? entry.v > best.v : entry.v < best.v) best = entry;
  }
  return best.i;
}

function row(
  id: string,
  label: string,
  direction: CompareDirection,
  values: CompareValue[],
  note: string | null = null,
): CompareRow {
  return { id, label, direction, values, bestIndex: pickBest(values, direction), note };
}

/* -------------------------------------------------------------- the model */

export interface CategoryMeta {
  readonly id: string;
  readonly label: string;
  readonly side: "competition" | "demand";
}

/**
 * Build the comparison table, its caveats and its narrative.
 *
 * `categories` is the taxonomy, passed in rather than imported so this module
 * stays a pure function of its arguments and the tests can drive it with a
 * fixed set.
 */
export function buildComparison(
  subjects: readonly CompareSubject[],
  categories: readonly CategoryMeta[],
): ComparisonModel {
  const rows: CompareRow[] = [];

  const sat = (s: CompareSubject, categoryId: string) =>
    s.saturatedCategoryIds.includes(categoryId);

  rows.push(
    row(
      "score",
      "Site score",
      "higher",
      subjects.map((s) =>
        s.score
          ? {
              display: `${Math.round(s.score.total)}${s.score.basis === "desk_only" ? " · desk only" : ""}`,
              numeric: s.score.total,
              qualified: false,
            }
          : ABSENT,
      ),
      "Out of 100. A desk-only score excludes the site survey and is not comparable with a surveyed one.",
    ),
  );

  rows.push(
    row(
      "facilities",
      "Sports facilities",
      "lower",
      subjects.map((s) => countValue(s.facilityCount, s.anySaturated)),
      "Google-listed competing facilities inside the radius. Fewer is a thinner market to enter.",
    ),
  );

  rows.push(
    row(
      "demand",
      "Demand places",
      "higher",
      subjects.map((s) => countValue(s.demandCount, s.anySaturated)),
      "Schools, colleges, workplaces, homes and transit points counted as demand anchors.",
    ),
  );

  for (const category of categories) {
    const values = subjects.map((s) => {
      // A category this scan never searched for has no count — it is not zero.
      if (!s.categoryIds.includes(category.id)) return ABSENT;
      return countValue(s.categoryCounts[category.id] ?? 0, sat(s, category.id));
    });
    if (values.every((v) => v.numeric === null)) continue;
    rows.push(
      row(
        `category:${category.id}`,
        category.label,
        category.side === "competition" ? "lower" : "higher",
        values,
        values.some((v) => v.numeric === null) ? "— means this scan did not search for it." : null,
      ),
    );
  }

  rows.push(
    row(
      "reviews",
      "Total reviews",
      "higher",
      subjects.map((s) => countValue(s.reviewTotal, false)),
      "Across competing facilities. Volume is the evidence that people pay to play here.",
    ),
  );

  rows.push(
    row(
      "rating",
      "Avg competitor rating",
      "none",
      subjects.map((s) =>
        s.avgRating === null
          ? ABSENT
          : { display: s.avgRating.toFixed(1), numeric: s.avgRating, qualified: false },
      ),
      "No winner is marked: a low rating is both a weaker competitor and a weaker market.",
    ),
  );

  rows.push(
    row(
      "anchors",
      "Weighted demand anchors",
      "higher",
      subjects.map((s) =>
        s.weightedAnchorTotal === null
          ? ABSENT
          : {
              display: fmt(s.weightedAnchorTotal, 1),
              numeric: s.weightedAnchorTotal,
              qualified: false,
            },
      ),
      "Demand places weighted by type and distance-decayed from the scan centre.",
    ),
  );

  rows.push(
    row(
      "saturation",
      "Anchors per facility",
      "higher",
      subjects.map((s) =>
        s.anchorsPerFacility === null
          ? ABSENT
          : {
              display: `1 per ${fmt(s.anchorsPerFacility, 1)}`,
              numeric: s.anchorsPerFacility,
              qualified: false,
            },
      ),
      // Deliberately free of the words "population", "resident", "density" and
      // their neighbours — even in a denial. Phase 3 keeps that vocabulary out
      // of every generated string so the assertion can be absolute rather than
      // an allowlist somebody later widens. The disclosure itself is
      // POPULATION_LIMITATION_TEXT, printed verbatim under the Read card.
      "Weighted demand anchors served by each Google-listed facility. Higher means less served.",
    ),
  );

  return {
    subjects,
    rows,
    warnings: buildWarnings(subjects, categories),
    narrative: buildNarrative(subjects, categories),
    anySaturated: subjects.some((s) => s.anySaturated),
  };
}

/* ------------------------------------------------------------- warnings */

function buildWarnings(
  subjects: readonly CompareSubject[],
  categories: readonly CategoryMeta[],
): CompareWarning[] {
  const warnings: CompareWarning[] = [];
  if (subjects.length < 2) return warnings;

  const radii = [...new Set(subjects.map((s) => s.radiusM))].sort((a, b) => a - b);
  if (radii.length > 1) {
    warnings.push({
      code: "compare_radius_mismatch",
      severity: "warning",
      message:
        `These scans used different radii (${radii.map((r) => `${r / 1000} km`).join(", ")}). ` +
        `A wider scan finds more of everything, so the counts below are not like for like. ` +
        `Re-run the smaller scans at the same radius before using this table with a customer.`,
    });
  }

  const termSets = subjects.map((s) => [...s.categoryIds].sort().join("|"));
  if (new Set(termSets).size > 1) {
    const missing = new Map<string, string[]>();
    const all = new Set(subjects.flatMap((s) => s.categoryIds));
    for (const subject of subjects) {
      const gaps = [...all]
        .filter((id) => !subject.categoryIds.includes(id))
        .map((id) => categories.find((c) => c.id === id)?.label ?? id);
      if (gaps.length > 0) missing.set(subject.areaLabel, gaps);
    }
    warnings.push({
      code: "compare_terms_mismatch",
      severity: "warning",
      message:
        `These scans searched for different categories. ` +
        [...missing.entries()]
          .map(([area, gaps]) => `${area} did not search for ${gaps.join(", ")}`)
          .join("; ") +
        `. Those rows read "—", not zero, because nobody looked.`,
    });
  }

  const scored = subjects.filter((s) => s.score !== null);
  const bases = new Set(scored.map((s) => s.score!.basis));
  if (bases.size > 1) {
    const deskOnly = scored.filter((s) => s.score!.basis === "desk_only").map((s) => s.areaLabel);
    warnings.push({
      code: "compare_mixed_score_basis",
      severity: "warning",
      message:
        `${deskOnly.join(" and ")} ${deskOnly.length === 1 ? "has" : "have"} a desk-only score: ` +
        `no site survey was recorded, so the site-practicals component was excluded and the ` +
        `remaining 85 points were rescaled to 100. An unvisited site can out-rank a visited one ` +
        `for that reason alone. Do not rank these scores against each other until every site has ` +
        `been surveyed.`,
    });
  }

  if (scored.length > 0 && scored.length < subjects.length) {
    const unscored = subjects.filter((s) => s.score === null).map((s) => s.areaLabel);
    warnings.push({
      code: "compare_unscored",
      severity: "info",
      message: `${unscored.join(", ")} ${unscored.length === 1 ? "has" : "have"} not been scored yet, so the score row is blank for ${unscored.length === 1 ? "it" : "them"}.`,
    });
  }

  if (subjects.some((s) => s.anySaturated)) {
    const areas = subjects.filter((s) => s.anySaturated).map((s) => s.areaLabel);
    warnings.push({
      code: "compare_counts_are_floors",
      severity: "warning",
      message:
        `Some searches in ${areas.join(", ")} returned the maximum number of results a single ` +
        `query can, so those counts are floors. They read "at least N" and must not be quoted as ` +
        // "census" is banned vocabulary across every generated string (Phase 3
        // §6) and this message reaches a customer-facing PDF. The word only
        // escaped the population assertion here because the test's fixture
        // never truncates, so the warning was never in the scanned text.
        `a complete count.`,
    });
  }

  const thin = subjects.filter(
    (s) => s.anchorsPerFacility !== null && s.benchmarkSampleCount > 0 && s.benchmarkSampleCount < 5,
  );
  if (thin.length > 0) {
    warnings.push({
      code: "compare_thin_benchmark",
      severity: "info",
      message:
        `The city benchmark behind the saturation row rests on ` +
        `${thin.map((s) => `${s.benchmarkSampleCount} scan${s.benchmarkSampleCount === 1 ? "" : "s"} in ${s.benchmarkCity ?? "this city"}`).join(", ")}. ` +
        `That is too few to be a city statistic — treat the comparison as indicative.`,
    });
  }

  const noBenchmark = subjects.filter(
    (s) => s.anchorsPerFacility !== null && s.benchmarkSampleCount === 0,
  );
  if (noBenchmark.length > 0) {
    warnings.push({
      code: "compare_no_benchmark",
      severity: "info",
      message:
        `No city benchmark exists yet for ${noBenchmark.map((s) => s.areaLabel).join(", ")}. ` +
        `Saturation there is reported against the scoring model's stated default, which is a ` +
        `default and not a measurement.`,
    });
  }

  return warnings;
}

/* ------------------------------------------------------------ narrative */

function pluralArea(n: number): string {
  return n === 1 ? "area" : "areas";
}

/**
 * The "Read" card, written from the table.
 *
 * Every sentence cites a figure that appears in a row above it. Nothing here
 * projects revenue, return or payback — the report's own disclaimer says it
 * makes no such projection, and a narrative that drifted into one would
 * contradict the page it is printed on.
 */
function buildNarrative(
  subjects: readonly CompareSubject[],
  categories: readonly CategoryMeta[],
): string[] {
  if (subjects.length === 0) {
    return ["Pick two or three saved scans to compare them."];
  }
  if (subjects.length === 1) {
    const only = subjects[0]!;
    return [
      `Only ${only.areaLabel} is selected. Pick at least one more ${pluralArea(1)} — a single column is a scan, not a comparison.`,
    ];
  }

  const out: string[] = [];
  const q = (s: CompareSubject, n: number) => (s.anySaturated ? `at least ${n}` : `${n}`);

  /* Demand pool. */
  const byDemand = [...subjects].sort((a, b) => b.demandCount - a.demandCount);
  const deepest = byDemand[0]!;
  const shallowest = byDemand[byDemand.length - 1]!;
  if (deepest.demandCount !== shallowest.demandCount) {
    // Phrased to read correctly with or without the "at least" qualifier —
    // "at at least 6" is the giveaway that a sentence was assembled rather
    // than written.
    out.push(
      `${deepest.areaLabel} has the deepest demand pool: ${q(deepest, deepest.demandCount)} demand ` +
        `places, against ${q(shallowest, shallowest.demandCount)} in ${shallowest.areaLabel}.`,
    );
  } else {
    out.push(
      `All ${subjects.length} ${pluralArea(subjects.length)} carry a similar demand pool — ` +
        `around ${q(deepest, deepest.demandCount)} demand places each.`,
    );
  }

  /* Supply. */
  const bySupply = [...subjects].sort((a, b) => a.facilityCount - b.facilityCount);
  const thinnest = bySupply[0]!;
  const busiest = bySupply[bySupply.length - 1]!;
  if (thinnest.facilityCount !== busiest.facilityCount) {
    out.push(
      `${busiest.areaLabel} carries the most existing supply: ${q(busiest, busiest.facilityCount)} ` +
        `Google-listed facilities, against ${q(thinnest, thinnest.facilityCount)} in ${thinnest.areaLabel}.`,
    );
  }

  /* Saturation — the metric that puts the two together. */
  const withSaturation = subjects.filter(
    (s): s is CompareSubject & { anchorsPerFacility: number } => s.anchorsPerFacility !== null,
  );
  if (withSaturation.length >= 2) {
    const leanest = [...withSaturation].sort(
      (a, b) => b.anchorsPerFacility - a.anchorsPerFacility,
    )[0]!;
    out.push(
      `On weighted demand anchors per facility — the two figures read together — ${leanest.areaLabel} ` +
        `is the least served, at one facility per ${leanest.anchorsPerFacility.toFixed(1)} anchors` +
        (leanest.benchmarkAnchorsPerFacility !== null && leanest.benchmarkSampleCount > 0
          ? ` against a ${leanest.benchmarkCity ?? "city"} median of one per ` +
            `${leanest.benchmarkAnchorsPerFacility.toFixed(1)} (benchmark from ` +
            `${leanest.benchmarkSampleCount} scan${leanest.benchmarkSampleCount === 1 ? "" : "s"})`
          : ", with no city benchmark to compare it against yet") +
        `.`,
    );
  }

  /* An unserved format is the most actionable single sentence on the page. */
  const gaps: string[] = [];
  for (const category of categories) {
    if (category.side !== "competition") continue;
    for (const subject of subjects) {
      if (!subject.categoryIds.includes(category.id)) continue;
      const count = subject.categoryCounts[category.id] ?? 0;
      if (count === 0 && subject.demandCount > 0) {
        gaps.push(`${category.label} in ${subject.areaLabel}`);
      }
    }
  }
  if (gaps.length > 0) {
    out.push(
      `The scans found no Google-listed ${gaps.slice(0, 3).join(", no ")}` +
        (gaps.length > 3 ? `, and ${gaps.length - 3} more format gaps` : "") +
        `, despite measured demand in the same catchment.`,
    );
  }

  /* Scores, only where they are comparable. */
  const scored = subjects.filter((s) => s.score !== null);
  if (scored.length >= 2) {
    const bases = new Set(scored.map((s) => s.score!.basis));
    const top = [...scored].sort((a, b) => b.score!.total - a.score!.total)[0]!;
    if (bases.size === 1) {
      out.push(
        `${top.areaLabel} scores highest at ${Math.round(top.score!.total)} out of 100 ` +
          `(${top.score!.verdict}, ${top.score!.confidence} confidence). Read the component ` +
          `breakdown on that scan before acting on the ranking.`,
      );
    } else {
      out.push(
        `The scores are not directly comparable: some were computed without a site survey and ` +
          `rescaled to 100 without the site-practicals component. Survey the remaining sites ` +
          `before ranking them against each other.`,
      );
    }
  }

  return out;
}
