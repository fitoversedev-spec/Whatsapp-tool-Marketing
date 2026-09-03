/**
 * Affluence tiering.
 *
 * **Unreachable in this build** — nothing calls it while population is
 * deferred. It exists so switching population on is an ingest plus a config
 * change rather than a design exercise, and it is unit-tested so it does not
 * rot in the meantime.
 *
 * Every threshold here is an **uncalibrated prior**. None has been checked
 * against a known site. That is why `confidence` falls out of how many signals
 * were present rather than being asserted, and why `signals` names each input
 * in plain words that go straight into the report.
 */
import type { AffluenceConfidence, AffluenceTier, CatchmentAffluence } from "./types";

export interface AffluenceSignalInputs {
  /** Census district urban share, 0–1. */
  urbanShare?: number | null;
  /** Median Google `priceLevel` of nearby cafés and restaurants, 0–4. */
  medianPriceLevel?: number | null;
  /** VIIRS annual nightlight radiance, nW·cm⁻²·sr⁻¹. */
  nightlightRadiance?: number | null;
}

/**
 * Radiance treated as the top of the scale.
 *
 * A prior, from the order of magnitude of dense Indian urban cores in the EOG
 * annual composites. Calibrate before any of this reaches a report.
 */
export const NIGHTLIGHT_SATURATION_RADIANCE = 60;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function tierFor(score: number): AffluenceTier {
  if (score >= 0.75) return "A";
  if (score >= 0.5) return "B";
  if (score >= 0.25) return "C";
  return "D";
}

function confidenceFor(signalCount: number): AffluenceConfidence {
  if (signalCount >= 3) return "high";
  if (signalCount === 2) return "medium";
  return "low";
}

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Derive an affluence tier from whatever signals are present.
 *
 * Returns `null` when no signal is present. It does **not** fall back to a
 * middle tier: "C because we know nothing" is indistinguishable in a report
 * from "C because we measured it", and that is the class of quiet fabrication
 * this codebase is built to prevent.
 */
export function deriveAffluence(inputs: AffluenceSignalInputs): CatchmentAffluence | null {
  const scores: number[] = [];
  const signals: string[] = [];

  if (usable(inputs.urbanShare)) {
    const share = clamp01(inputs.urbanShare);
    scores.push(share);
    signals.push(`Census urban share ${(share * 100).toFixed(0)}%`);
  }

  if (usable(inputs.medianPriceLevel)) {
    const level = Math.min(4, Math.max(0, inputs.medianPriceLevel));
    scores.push(level / 4);
    signals.push(`Median Google price level ${level.toFixed(1)} of 4 for nearby food and drink`);
  }

  if (usable(inputs.nightlightRadiance) && inputs.nightlightRadiance >= 0) {
    const radiance = inputs.nightlightRadiance;
    const score = clamp01(
      Math.log10(1 + radiance) / Math.log10(1 + NIGHTLIGHT_SATURATION_RADIANCE),
    );
    scores.push(score);
    signals.push(`VIIRS nightlight radiance ${radiance.toFixed(1)} nW·cm⁻²·sr⁻¹`);
  }

  if (scores.length === 0) return null;

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { tier: tierFor(mean), signals, confidence: confidenceFor(scores.length) };
}
