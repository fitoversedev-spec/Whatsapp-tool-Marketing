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
      className={["bg-[var(--surface-card)] border border-[color:var(--border-default)] rounded-[18px] p-[18px] flex flex-col gap-3.5 font-sans", className].filter(Boolean).join(" ")}
      aria-labelledby="saturation-heading"
    >
      <SectionLabel weight={700} as="h2">
        <span id="saturation-heading">Competitive saturation</span>
      </SectionLabel>

      <div className="grid grid-cols-1 min-[1100px]:grid-cols-[1.3fr_1fr] gap-2.5">
        <div className="bg-[var(--black)] text-[color:var(--on-dark)] rounded-lg p-[15px]">
          <div className="font-display text-[30px] font-bold leading-[1.1] flex items-baseline gap-[7px]">
            {figures.anchorsPerFacility === null ? (
              "—"
            ) : (
              <>
                1<span className="font-sans text-[length:var(--text-11)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[color:var(--on-dark-muted)]">per</span>
                {figures.anchorsPerFacility.toFixed(1)}
              </>
            )}
          </div>
          <div className="text-[length:var(--text-10-5)] tracking-[var(--tracking-stat-sm)] uppercase text-[color:var(--on-dark-muted)] mt-[9px] leading-normal">
            Google-listed facility per weighted demand anchor
          </div>
        </div>

        <div className="border border-[color:var(--border-default)] rounded-lg p-[15px]">
          <div className="font-display text-[22px] font-bold leading-[1.1] text-blue-700">
            {figures.benchmarkAnchorsPerFacility === null
              ? "—"
              : `1 per ${figures.benchmarkAnchorsPerFacility.toFixed(1)}`}
          </div>
          <div className="text-[length:var(--text-10-5)] tracking-[var(--tracking-stat-sm)] uppercase text-slate-500 mt-[9px] leading-normal">
            {figures.benchmarkIsModelDefault
              ? "Scoring model default — no city benchmark yet"
              : `${figures.benchmarkCity ?? "City"} median`}
          </div>
        </div>
      </div>

      {standing ? (
        <p className="m-0 text-[length:var(--text-13)] leading-[1.7] text-slate-700">
          This catchment is <strong>{standing}</strong>{" "}
          {figures.benchmarkIsModelDefault ? "the model’s stated default" : "the city median"}
          {figures.facilityCount !== null && figures.weightedAnchorTotal !== null
            ? ` — ${figures.facilityCount} ${figures.facilityCount === 1 ? "facility" : "facilities"} against ${figures.weightedAnchorTotal.toFixed(1)} weighted anchors.`
            : "."}
        </p>
      ) : null}

      {/* The sample count, made visible. */}
      <div className="border border-[color:var(--border-default)] rounded-[12px] p-[13px] flex flex-col gap-[9px] bg-slate-100">
        <div className="flex items-baseline justify-between gap-2.5">
          <SectionLabel>Benchmark rests on</SectionLabel>
          <span className="font-display text-[length:var(--text-13-5)] font-bold text-ink" data-testid="benchmark-sample-count">
            {figures.benchmarkIsModelDefault
              ? "0 scans"
              : `${figures.benchmarkSampleCount} scan${figures.benchmarkSampleCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <div
          className="flex items-center gap-[5px] flex-wrap"
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
              className={`w-[9px] h-[9px] rounded-full border ${
                !figures.benchmarkIsModelDefault && i < Math.min(figures.benchmarkSampleCount, SAMPLE_DOTS)
                  ? indicative ? "bg-transparent border-blue-500" : "bg-blue-500 border-blue-500"
                  : "bg-transparent border-[color:var(--border-strong)]"
              }`}
            />
          ))}
          {figures.benchmarkSampleCount > SAMPLE_DOTS ? (
            <span className="text-[length:var(--text-10-5)] font-semibold text-blue-700 ml-[3px]">+{figures.benchmarkSampleCount - SAMPLE_DOTS}</span>
          ) : null}
        </div>
        <p className="m-0 text-[length:var(--text-11-5)] leading-[1.65] text-slate-700">
          {caveat ??
            "No city benchmark exists yet, so saturation is measured against the scoring model’s " +
              "stated default. That is a default, not a measurement. Benchmarks build themselves " +
              "as the team runs more scans in the same city."}
        </p>
      </div>

      <p className="m-0 text-[length:var(--text-11)] leading-[1.65] text-slate-500">{SATURATION_METHOD_NOTE}</p>

      <div className="flex gap-[18px] flex-wrap border-t border-[color:var(--border-default)] pt-[11px] text-[length:var(--text-11)] text-slate-500">
        <span>
          Catchment area {areaKm2.toFixed(2)} km<sup>2</sup>
        </span>
        <span>
          Component 2: {figures.points.toFixed(1)} / {figures.available.toFixed(0)}
        </span>
      </div>

      {saturatedTerms.length > 0 ? (
        <div className="border border-[color:var(--plot-amber)] rounded-[12px] py-3 px-[13px] flex flex-col gap-[7px]" role="note">
          <SectionLabel weight={700}>Counts below are floors, not a census</SectionLabel>
          <ul className="m-0 pl-[17px] text-[length:var(--text-11-5)] leading-[1.7] text-slate-700">
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
