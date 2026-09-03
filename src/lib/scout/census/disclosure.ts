/**
 * What the application says — and does not say — about population.
 *
 * Deliberately free of every server import (`server-only`, `@/db`, `pg`) so a
 * client component in Phase 4 or 5 can read `populationAvailable` without
 * dragging the database driver into the browser bundle.
 */

/**
 * Whether population data is loaded and may be shown.
 *
 * `false` in this build. Read from `NEXT_PUBLIC_POPULATION_DATA_ENABLED` rather
 * than hardcoded so switching it on is a configuration change and a redeploy,
 * not an edit to application code. `NEXT_PUBLIC_` is intentional: the same
 * variable gates the server query and the client panel, and one flag that
 * cannot disagree with itself beats two that can.
 *
 * Typed as `boolean`, not `false`, so Phase 4 and 5 can write the
 * population-panel branch and have it typecheck today.
 *
 * ## What this flag does NOT authorise
 *
 * Turning it on does not make population data exist. It only stops
 * `getCatchmentProfile` short-circuiting. If the tables are empty the profile
 * still returns `available: false`, which is the correct answer. There is no
 * configuration that produces a population figure from an empty table.
 */
export const populationAvailable: boolean =
  (process.env.NEXT_PUBLIC_POPULATION_DATA_ENABLED ?? "").trim().toLowerCase() === "true";

/**
 * Server-side read of the same flag, evaluated per call.
 *
 * Next inlines `NEXT_PUBLIC_*` at build time for the client bundle; on the
 * server this still reads the live value, which keeps tests able to flip it.
 */
export function isPopulationEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_POPULATION_DATA_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Heading the report renderer puts above the limitations block. */
export const LIMITATIONS_HEADING = "What this assessment does not cover";

/**
 * The population limitation, verbatim, for the report's limitations section.
 *
 * This is not boilerplate. It is the sentence that stops a reader inferring a
 * catchment population from the rest of the report, and it must appear on any
 * document that carries a saturation figure. Phase 6 includes it; Phase 3
 * asserts no other output contradicts it.
 */
export const POPULATION_LIMITATION_TEXT =
  "Population and census data are not part of this assessment. This report contains no " +
  "catchment population, no population density, and no per-capita or per-100,000-residents " +
  "figure of any kind. Competitive saturation is measured against weighted demand anchors — " +
  "the schools, colleges, offices, apartment complexes, hostels and transit points counted " +
  "within the scan radius — rather than against a resident population. A demand-anchor " +
  "denominator is a weaker basis for comparison than a population one, and it is stated here " +
  "so the figures are read for what they are.";

/**
 * The saturation-method note, for the panel that prints the saturation number.
 *
 * Shorter than the full limitation and placed next to the figure itself, because
 * a caveat three pages away from the number it qualifies is not a caveat.
 */
export const SATURATION_METHOD_NOTE =
  "Saturation is expressed as facilities per unit of weighted demand anchor, benchmarked " +
  "against other scans in the same city. It is not a per-resident figure.";

/**
 * The limitations block as the report renderer wants it.
 *
 * A single call site so a future v2.0 that reinstates population changes this
 * function and nothing else.
 */
export function populationLimitations(): { heading: string; paragraphs: string[] } {
  if (populationAvailable) {
    return {
      heading: LIMITATIONS_HEADING,
      paragraphs: [
        "Population figures are modelled estimates from gridded population data, not a census " +
          "count of the catchment. Age and household ratios are applied from district-level " +
          "census tables and are older than the population totals they are applied to.",
      ],
    };
  }
  return { heading: LIMITATIONS_HEADING, paragraphs: [POPULATION_LIMITATION_TEXT] };
}

/**
 * How much weight a city benchmark can carry, given how many scans produced it.
 *
 * The brief is explicit that the difference between a three-scan median and a
 * forty-scan median must be *visible, never implied*. This returns the sentence
 * that makes it visible, and `null` only when there is no benchmark to qualify.
 */
export function benchmarkSampleCaveat(sampleCount: number): string | null {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    return "No city benchmark is available yet. Saturation is reported without a comparison figure.";
  }
  const scans = `${sampleCount} scan${sampleCount === 1 ? "" : "s"}`;
  if (sampleCount < 5) {
    return `Derived from ${scans} in this city — too few to be a city statistic. Treat it as indicative only.`;
  }
  if (sampleCount < 15) {
    return `Derived from ${scans} in this city. A working benchmark, still thin enough that one unusual area moves it.`;
  }
  return `Derived from ${scans} in this city.`;
}

/** Below this, a benchmark is shown with the caveat but never as a headline claim. */
export const BENCHMARK_INDICATIVE_BELOW = 5;
