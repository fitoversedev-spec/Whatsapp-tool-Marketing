"use client";

import { useState } from "react";
import type { ScoreResult } from "@/lib/scout/scoring/types";
import { Badge } from "@/components/scout/ui";
import { SectionLabel } from "@/components/scout/patterns";
import { confidenceLabel, verdictLabel, verdictTone } from "@/lib/scout/display/format";
import styles from "./ScorePanel.module.css";

export interface ScorePanelProps {
  score: ScoreResult;
  /** ISO timestamp the score was computed. */
  scoredAt?: string | null;
  /** Shown as small print when review analysis has not finished. */
  themesPending?: boolean;
  onRefresh?: () => void;
  className?: string;
}

/**
 * The Site Score, designed against the existing token set.
 *
 * Nothing in the mockups showed a score, so this follows the language the rest
 * of the screens already speak: the numeral is the inverted `#0a0a0a` stat card
 * from the D2 2×2 grid, scaled up; the verdict is a `Badge` in the green /
 * blue / red tones the design system already ships; the component bars use the
 * blue ramp (`--blue-100` track, `--blue-500` fill) that the comparison table
 * already uses to mark a winning value.
 *
 * ## The one rule this component enforces structurally
 *
 * **The number never renders without its breakdown.** Not "should not" — the
 * component has no mode that draws the numeral alone, because a bare 74 is
 * exactly the thing a salesperson cannot defend across a table. Every bar
 * expands to the justification sentence Phase 3 wrote, which cites its own
 * inputs, and those inputs are listed underneath it.
 *
 * Two things travel with the number and are drawn at the same size as it, not
 * as footnotes: the **confidence level** (a 78 at low confidence is a different
 * recommendation from a 78 at high confidence) and the **basis** (a desk-only
 * score excluded the site survey and was rescaled to 100, so it can out-rank a
 * surveyed site for no good reason).
 */
export function ScorePanel({
  score,
  scoredAt,
  themesPending = false,
  onRefresh,
  className,
}: ScorePanelProps) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section
      className={[styles.panel, className].filter(Boolean).join(" ")}
      aria-labelledby="score-heading"
    >
      <div className={styles.headline}>
        <div className={styles.numberBlock}>
          <div className={styles.number}>
            {score.totalRounded}
            <span className={styles.outOf}>/100</span>
          </div>
          <SectionLabel weight={700} onDark as="h2" className={styles.headingLabel}>
            <span id="score-heading">Site score</span>
          </SectionLabel>
        </div>
        <div className={styles.verdictBlock}>
          <Badge tone={verdictTone(score.verdict)}>{verdictLabel(score.verdict)}</Badge>
          <div className={styles.confidence}>{confidenceLabel(score.confidence.level)}</div>
          {score.basis === "desk_only" ? (
            <div className={styles.basis} data-testid="score-basis-label">
              {score.basisLabel}
            </div>
          ) : null}
        </div>
      </div>

      <p className={styles.statement}>{score.verdictStatement}</p>

      {score.hardFlags.length > 0 ? (
        <div className={styles.hardFlags} role="alert">
          <SectionLabel weight={700}>Must be read whatever the score says</SectionLabel>
          {score.hardFlags.map((flag) => (
            <p key={flag.code} className={styles.hardFlag}>
              {flag.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className={styles.components}>
        <SectionLabel weight={700}>Where the points came from</SectionLabel>
        {score.components.map((component) => {
          const expanded = open === component.id;
          const pct =
            component.available > 0
              ? Math.max(0, Math.min(100, (component.points / component.available) * 100))
              : 0;
          return (
            <div key={component.id} className={styles.component}>
              <button
                type="button"
                className={styles.componentButton}
                aria-expanded={expanded}
                aria-controls={`component-${component.id}`}
                onClick={() => setOpen(expanded ? null : component.id)}
              >
                <span className={styles.componentTop}>
                  <span className={styles.componentLabel}>{component.label}</span>
                  <span className={styles.componentPoints}>
                    {component.included ? (
                      <>
                        <span className={styles.pointsAwarded}>
                          {component.points.toFixed(1)}
                        </span>
                        <span className={styles.pointsAvailable}>
                          /{component.available.toFixed(0)}
                        </span>
                      </>
                    ) : (
                      <span className={styles.excluded}>Excluded</span>
                    )}
                    <Chevron open={expanded} />
                  </span>
                </span>
                <span
                  className={[styles.track, !component.included && styles.trackExcluded]
                    .filter(Boolean)
                    .join(" ")}
                  role="img"
                  aria-label={
                    component.included
                      ? `${component.points.toFixed(1)} of ${component.available.toFixed(0)} points`
                      : "Excluded from the total and from the denominator"
                  }
                >
                  {component.included ? (
                    <span className={styles.fill} style={{ width: `${pct}%` }} />
                  ) : null}
                </span>
              </button>

              <div
                id={`component-${component.id}`}
                className={styles.detail}
                hidden={!expanded}
              >
                <p className={styles.justification}>{component.justification}</p>

                {component.parts.length > 0 ? (
                  <ul className={styles.parts}>
                    {component.parts.map((part) => (
                      <li key={part.id} className={styles.part}>
                        <span className={styles.partLabel}>{part.label}</span>
                        <span className={styles.partPoints}>
                          {part.available === null
                            ? part.points.toFixed(2)
                            : `${part.points.toFixed(1)}/${part.available.toFixed(0)}`}
                        </span>
                        <span className={styles.partDetail}>{part.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {component.flags.length > 0 ? (
                  <ul className={styles.flags}>
                    {component.flags.map((flag) => (
                      <li key={flag.code} className={styles[`flag_${flag.severity}`]}>
                        {flag.message}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <dl className={styles.inputs}>
                  {Object.entries(component.inputs).map(([key, value]) => (
                    <div key={key} className={styles.inputRow}>
                      <dt>{humanise(key)}</dt>
                      <dd>{renderInput(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          );
        })}
      </div>

      {score.confidence.reasons.length > 0 ? (
        <div className={styles.confidenceBlock}>
          <SectionLabel weight={700}>
            Why confidence is {score.confidence.level}
          </SectionLabel>
          <ul className={styles.reasons}>
            {score.confidence.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className={styles.footer}>
        <span>
          Model v{score.modelVersion} · checklist v{score.checklistVersion}
          {scoredAt ? ` · scored ${new Date(scoredAt).toLocaleString("en-GB")}` : ""} ·{" "}
          {score.pointsAwarded.toFixed(1)} of {score.pointsAvailable.toFixed(0)} points available
        </span>
        {themesPending ? (
          <span className={styles.pending}>
            Review analysis is still running, so the service-gap component may rise.{" "}
            {onRefresh ? (
              <button type="button" className={styles.refresh} onClick={onRefresh}>
                Refresh the score
              </button>
            ) : null}
          </span>
        ) : null}
      </footer>
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[styles.chevron, open && styles.chevronOpen].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** `benchmarkSampleCount` → "Benchmark sample count". */
function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function renderInput(value: number | string | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return value;
}
