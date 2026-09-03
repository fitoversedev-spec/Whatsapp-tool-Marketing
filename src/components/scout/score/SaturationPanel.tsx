import type { ScoreResult } from "@/lib/scout/scoring/types";
import { SectionLabel } from "@/components/scout/patterns";
import {
  catchmentAreaKm2,
  saturationFigures,
  saturationStanding,
} from "@/lib/scout/display/saturation";
import {
  BENCHMARK_INDICATIVE_BELOW,
  benchmarkSampleCaveat,
  SATURATION_METHOD_NOTE,
} from "@/lib/scout/census/disclosure";
import styles from "./SaturationPanel.module.css";

export interface SaturationTermWarning {
  readonly termLabel: string;
  readonly saturatedTiles: number;
  readonly totalTiles: number;
}

export interface SaturationPanelProps {
  score: ScoreResult;
  radiusM: number;
  /** Phase 1's per-term truncation flags, surfaced inline. */
  saturatedTerms?: readonly SaturationTermWarning[];
  className?: string;
}

/** Dots that make the benchmark's sample size a picture, not a footnote. */
const SAMPLE_DOTS = 15;

/**
 * The saturation panel — the block that replaces the deferred population one.
 *
 * There is **no population panel and no placeholder** on this screen. Phase 2
 * left `populationAvailable` false and was explicit that a "coming soon" box is
 * worse than an absence, because it invites the reader to assume the number
 * exists somewhere. So the block is simply not rendered, and what is rendered
 * instead is the denominator we actually have: weighted demand anchors.
 *
 * ## What this panel is really for
 *
 * Making the benchmark's sample size **visible rather than implied**. "A
 * Bengaluru median of one per 4.1" reads with the authority of a statistic
 * whether it came from three scans or forty. So the sample count is printed in
 * full, drawn as a row of dots against the fifteen-scan mark where a benchmark
 * stops moving on one unusual area, and carries Phase 2's ready-made caveat
 * sentence. Below five scans the comparison is labelled indicative and the
 * dots are drawn in outline.
 */
export function SaturationPanel({
  score,
  radiusM,
  saturatedTerms = [],
  className,
}: SaturationPanelProps) {
  const figures = saturationFigures(score);
  if (!figures) return null;

  const standing = saturationStanding(figures);
  const areaKm2 = catchmentAreaKm2(radiusM);
  const caveat = figures.benchmarkIsModelDefault
    ? null
    : benchmarkSampleCaveat(figures.benchmarkSampleCount);
  const indicative =
    !figures.benchmarkIsModelDefault && figures.benchmarkSampleCount < BENCHMARK_INDICATIVE_BELOW;

  return (
    <section
      className={[styles.panel, className].filter(Boolean).join(" ")}
      aria-labelledby="saturation-heading"
    >
      <SectionLabel weight={700} as="h2">
        <span id="saturation-heading">Competitive saturation</span>
      </SectionLabel>

      <div className={styles.figures}>
        <div className={styles.primary}>
          <div className={styles.bigNumber}>
            {figures.anchorsPerFacility === null ? (
              "—"
            ) : (
              <>
                1<span className={styles.per}>per</span>
                {figures.anchorsPerFacility.toFixed(1)}
              </>
            )}
          </div>
          <div className={styles.primaryLabel}>
            Google-listed facility per weighted demand anchor
          </div>
        </div>

        <div className={styles.benchmark}>
          <div className={styles.benchmarkValue}>
            {figures.benchmarkAnchorsPerFacility === null
              ? "—"
              : `1 per ${figures.benchmarkAnchorsPerFacility.toFixed(1)}`}
          </div>
          <div className={styles.benchmarkLabel}>
            {figures.benchmarkIsModelDefault
              ? "Scoring model default — no city benchmark yet"
              : `${figures.benchmarkCity ?? "City"} median`}
          </div>
        </div>
      </div>

      {standing ? (
        <p className={styles.standing}>
          This catchment is <strong>{standing}</strong>{" "}
          {figures.benchmarkIsModelDefault ? "the model's stated default" : "the city median"}
          {figures.facilityCount !== null && figures.weightedAnchorTotal !== null
            ? ` — ${figures.facilityCount} ${figures.facilityCount === 1 ? "facility" : "facilities"} against ${figures.weightedAnchorTotal.toFixed(1)} weighted anchors.`
            : "."}
        </p>
      ) : null}

      {/* The sample count, made visible. */}
      <div className={styles.sample}>
        <div className={styles.sampleHead}>
          <SectionLabel>Benchmark rests on</SectionLabel>
          <span className={styles.sampleCount} data-testid="benchmark-sample-count">
            {figures.benchmarkIsModelDefault
              ? "0 scans"
              : `${figures.benchmarkSampleCount} scan${figures.benchmarkSampleCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <div
          className={styles.dots}
          role="img"
          aria-label={
            figures.benchmarkIsModelDefault
              ? "No scans behind this benchmark"
              : `${figures.benchmarkSampleCount} of ${SAMPLE_DOTS} scans towards a settled benchmark`
          }
        >
          {Array.from({ length: SAMPLE_DOTS }, (_, i) => (
            <span
              key={i}
              className={[
                styles.dot,
                !figures.benchmarkIsModelDefault &&
                  i < Math.min(figures.benchmarkSampleCount, SAMPLE_DOTS) &&
                  (indicative ? styles.dotThin : styles.dotFull),
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
          {figures.benchmarkSampleCount > SAMPLE_DOTS ? (
            <span className={styles.dotsOverflow}>+{figures.benchmarkSampleCount - SAMPLE_DOTS}</span>
          ) : null}
        </div>
        <p className={styles.caveat}>
          {caveat ??
            "No city benchmark exists yet, so saturation is measured against the scoring model's " +
              "stated default. That is a default, not a measurement. Benchmarks build themselves " +
              "as the team runs more scans in the same city."}
        </p>
      </div>

      <p className={styles.method}>{SATURATION_METHOD_NOTE}</p>

      <div className={styles.meta}>
        <span>
          Catchment area {areaKm2.toFixed(2)} km<sup>2</sup>
        </span>
        <span>
          Component 2: {figures.points.toFixed(1)} / {figures.available.toFixed(0)}
        </span>
      </div>

      {saturatedTerms.length > 0 ? (
        <div className={styles.truncated} role="note">
          <SectionLabel weight={700}>Counts below are floors, not a census</SectionLabel>
          <ul className={styles.truncatedList}>
            {saturatedTerms.map((term) => (
              <li key={term.termLabel}>
                <strong>{term.termLabel}</strong> hit the per-search result ceiling on{" "}
                {term.saturatedTiles} of {term.totalTiles} tiles. Read its count as{" "}
                &ldquo;at least N&rdquo;.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
