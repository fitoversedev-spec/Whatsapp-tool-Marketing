import { benchmarkSampleCaveat, SATURATION_METHOD_NOTE } from "@/lib/scout/census/disclosure";
import type { ScoreResult } from "@/lib/scout/scoring";
import styles from "./SaturationRow.module.css";

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
    <section className={styles.row} aria-label="Competitive saturation">
      <div className={styles.head}>
        <span className={styles.label}>Competitive saturation</span>
        <span className={styles.points}>
          {`${component.points.toFixed(1)} / ${component.available}`}
        </span>
      </div>

      <div className={styles.figures}>
        <span className={styles.value}>
          {anchorsPerFacility === null ? "—" : `1 per ${anchorsPerFacility.toFixed(1)}`}
        </span>
        <span className={styles.against}>
          {benchmark === null
            ? "no comparison figure"
            : `vs ${isDefault ? "model default" : (city ?? "city")} 1 per ${benchmark.toFixed(1)}`}
        </span>
      </div>

      {/* Component 2's own sentence, printed verbatim. */}
      <p className={styles.note}>{component.justification}</p>
      <p className={styles.note}>{SATURATION_METHOD_NOTE}</p>
      {isDefault ? null : <p className={styles.caveat}>{benchmarkSampleCaveat(sampleCount)}</p>}
    </section>
  );
}
