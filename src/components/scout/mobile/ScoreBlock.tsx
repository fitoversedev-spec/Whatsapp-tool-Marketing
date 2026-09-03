"use client";

import { useState } from "react";
import { Badge } from "@/components/scout/ui";
import type { ComponentScore, ScoreFlag, ScoreResult } from "@/lib/scout/scoring";
import { verdictLabel, verdictTone } from "./format";
import { Sheet } from "./Sheet";
import styles from "./ScoreBlock.module.css";

export interface ScoreBlockProps {
  score: ScoreResult;
  /** True while review-theme extraction is still running (Phase 3 §8). */
  themesPending?: boolean;
  /** Offered when `themesPending`, because the number is about to change. */
  onRefresh?: () => void;
}

/**
 * The Site Score, first thing on the mobile results screen.
 *
 * ## Why the score is a button
 *
 * Phase 3's governing rule: *the score never appears without its breakdown.*
 * On a 1440px desktop that is satisfied by putting the five components beside
 * the number. On a 390px phone there is no beside, so the number itself is the
 * control that opens them — which means there is no arrangement of this screen
 * where a reader can see 66 and not be one tap from why.
 *
 * ## What travels with the number, always
 *
 * `verdict`, `confidence.level`, `basisLabel` and `modelVersion`. A 78 at low
 * confidence and a 78 at high confidence are different recommendations, and a
 * `desk_only` 78 is not comparable with a surveyed one at all.
 *
 * ## What is *not* here
 *
 * Any scoring logic. Every number, sentence and flag below is read straight off
 * the `ScoreResult` computed by `src/lib/scoring/`. `justification` is printed
 * verbatim because it is written to be read aloud across a table, and flags are
 * keyed off `flag.code`, never off their wording.
 */
export function ScoreBlock({ score, themesPending = false, onRefresh }: ScoreBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Site score">
      {/* Hard flags render regardless of the total, above it. */}
      {score.hardFlags.length > 0 ? (
        <div className={styles.hardFlags}>
          {score.hardFlags.map((flag) => (
            <p key={flag.code} className={styles.hardFlag} role="alert">
              <svg
                className={styles.hardFlagIcon}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 3l9.5 17h-19z" />
                <path d="M12 10v4M12 17.5h.01" />
              </svg>
              <span>{flag.message}</span>
            </p>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className={styles.card}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className={styles.top}>
          <span className={styles.label}>Site score</span>
          <Badge tone={verdictTone(score.verdict)}>{verdictLabel(score.verdict)}</Badge>
        </span>

        <span className={styles.numeralRow}>
          <span className={styles.numeral}>{score.totalRounded}</span>
          <span className={styles.outOf}>/ 100</span>
        </span>

        <span className={styles.meta}>
          {`${score.confidence.level} confidence · model v${score.modelVersion}`}
          {score.countsAreExact ? "" : " · counts are floors"}
        </span>

        {score.basisLabel ? <span className={styles.basis}>{score.basisLabel}</span> : null}

        <p className={styles.statement}>{score.verdictStatement}</p>

        <span className={styles.expand}>
          See the five-component breakdown
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} heading="How this score was built">
        <ScoreBreakdown score={score} themesPending={themesPending} onRefresh={onRefresh} />
      </Sheet>
    </section>
  );
}

function ScoreBreakdown({
  score,
  themesPending,
  onRefresh,
}: {
  score: ScoreResult;
  themesPending: boolean;
  onRefresh?: () => void;
}) {
  return (
    <div>
      {themesPending ? (
        <p className={styles.flag}>
          Review analysis is still running, so the service-gap component may still gain points.{" "}
          {onRefresh ? (
            <button type="button" onClick={onRefresh} className={styles.componentName}>
              Refresh the score
            </button>
          ) : null}
        </p>
      ) : null}

      {score.components.map((component) => (
        <ComponentRow key={component.id} component={component} />
      ))}

      <p className={styles.footnote}>
        {`Scored under model v${score.modelVersion}, checklist v${score.checklistVersion}. `}
        {`${score.pointsAwarded.toFixed(2)} of ${score.pointsAvailable} points available`}
        {score.pointsAvailable === 100 ? "." : ", rescaled to 100."}
        {score.basisLabel ? ` ${score.basisLabel}.` : ""}
      </p>

      <div className={styles.footnote}>
        <strong>{`Confidence: ${score.confidence.level}.`}</strong>
        {score.confidence.reasons.length > 0 ? (
          <ul className={styles.confidenceReasons}>
            {score.confidence.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function ComponentRow({ component }: { component: ComponentScore }) {
  const pct = component.available > 0 ? (component.points / component.available) * 100 : 0;

  return (
    <div className={styles.component}>
      <div className={styles.componentHead}>
        <span className={styles.componentName}>{component.label}</span>
        <span className={styles.componentPoints}>
          {component.included
            ? `${component.points.toFixed(1)} / ${component.available}`
            : "Not scored"}
        </span>
      </div>

      {component.included ? (
        <div className={styles.bar} role="presentation">
          <span className={styles.barFill} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      ) : null}

      {/* Printed verbatim: it is written to be read aloud. */}
      <p className={styles.justification}>{component.justification}</p>

      {component.included ? null : (
        <p className={styles.excluded}>
          Excluded from both the score and the points available, rather than scored as zero — an
          unobserved site is not a bad site.
        </p>
      )}

      {component.parts.length > 0 ? (
        <ul className={styles.parts}>
          {component.parts.map((part) => (
            <li key={part.id} className={styles.part}>
              <span>{part.detail || part.label}</span>
              <span className={styles.partPoints}>
                {part.available === null
                  ? part.points.toFixed(1)
                  : `${part.points.toFixed(1)}/${part.available}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {component.flags.length > 0 ? (
        <div className={styles.flags}>
          {component.flags.map((flag) => (
            <p key={flag.code} className={flagClass(flag)}>
              {flag.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function flagClass(flag: ScoreFlag): string {
  if (flag.severity === "hard") return [styles.flag, styles.flagHard].join(" ");
  if (flag.severity === "warning") return [styles.flag, styles.flagWarning].join(" ");
  return styles.flag ?? "";
}

/**
 * What sits where the score goes before there is one.
 *
 * A blank space would read as "this site has no score"; this reads as "the
 * score has not been computed yet", which is what is true.
 */
export function ScorePending({ message }: { message: string }) {
  return (
    <section aria-label="Site score" className={styles.pending}>
      {message}
    </section>
  );
}
