import { benchmarkSampleCaveat, SATURATION_METHOD_NOTE } from "@/lib/scout/census/disclosure";
import type { ScoreResult } from "@/lib/scout/scoring";

export interface SaturationRowProps {
  score: ScoreResult;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Saturation, compressed to one row.
 *
 * Everything here is read off component 2 of the `ScoreResult` — facilities,
 * weighted anchors, the ratio and the benchmark all arrive already computed by
 * `src/lib/scoring/componentSaturation.ts`. There is no second implementation
 * of the metric on the phone, and there must never be one: two copies of a
 * denominator eventually disagree, and the one on the salesperson's screen is
 * the one the land owner hears.
 *
 * `SATURATION_METHOD_NOTE` sits directly under the number, not three screens
 * away, because a caveat separated from the figure it qualifies is not a
 * caveat. The benchmark's sample count is printed every time for the same
 * reason: a median from three scans is a guess, from forty it is data.
 */
export function SaturationRow({ score }: SaturationRowProps) {
  const component = score.components.find((c) => c.id === "competitive-saturation");
  if (!component) return null;

  const anchorsPerFacility = asNumber(component.inputs.anchorsPerFacility);
  const benchmark = asNumber(component.inputs.benchmarkAnchorsPerFacility);
  const sampleCount = asNumber(component.inputs.benchmarkSampleCount) ?? 0;
  const city = typeof component.inputs.benchmarkCity === "string" ? component.inputs.benchmarkCity : null;
  const isDefault = component.inputs.benchmarkIsModelDefault === true;

  return (
    <section className="bg-[var(--surface-card)] border border-[color:var(--border-default)] rounded-lg p-3.5" aria-label="Competitive saturation">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[color:var(--m-muted-on-white)]">Competitive saturation</span>
        <span className="text-[length:var(--text-11-5)] text-[color:var(--m-muted-on-white)] flex-none">
          {`${component.points.toFixed(1)} / ${component.available}`}
        </span>
      </div>

      <div className="flex items-baseline gap-2.5 flex-wrap mt-[9px]">
        <span className="font-display text-[length:var(--text-xl)] font-bold tracking-[0.02em]">
          {anchorsPerFacility === null ? "—" : `1 per ${anchorsPerFacility.toFixed(1)}`}
        </span>
        <span className="text-[length:var(--text-12-5)] text-[color:var(--m-muted-on-white)]">
          {benchmark === null
            ? "no comparison figure"
            : `vs ${isDefault ? "model default" : (city ?? "city")} 1 per ${benchmark.toFixed(1)}`}
        </span>
      </div>

      {/* Component 2's own sentence, printed verbatim. */}
      <p className="mt-2.5 mb-0 text-[length:var(--text-11)] leading-[1.55] text-[color:var(--m-muted-on-white)]">{component.justification}</p>
      <p className="mt-2.5 mb-0 text-[length:var(--text-11)] leading-[1.55] text-[color:var(--m-muted-on-white)]">{SATURATION_METHOD_NOTE}</p>
      {isDefault ? null : <p className="mt-1.5 mb-0 text-[length:var(--text-11)] leading-[1.55] text-blue-700">{benchmarkSampleCaveat(sampleCount)}</p>}
    </section>
  );
}
