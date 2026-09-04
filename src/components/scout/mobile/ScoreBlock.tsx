"use client";

import { useState } from "react";
import { Badge } from "@/components/scout/ui";
import type { ComponentScore, ScoreFlag, ScoreResult } from "@/lib/scout/scoring";
import { verdictLabel, verdictTone } from "./format";
import { Sheet } from "./Sheet";

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
 * control that opens them --- which means there is no arrangement of this screen
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
        <div className="flex flex-col gap-2 mb-2.5">
          {score.hardFlags.map((flag) => (
            <p key={flag.code} className="flex items-start gap-[9px] bg-red-100 border border-red-500 rounded-[12px] py-[11px] px-3 text-[length:var(--text-12-5)] leading-normal text-ink" role="alert">
              <svg
                className="flex-none mt-px text-red-600"
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
        className="w-full text-left block bg-[var(--black)] text-[color:var(--on-dark)] border border-[color:var(--black)] rounded-[18px] p-4 font-sans cursor-pointer"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[color:var(--on-dark-muted)]">Site score</span>
          <Badge tone={verdictTone(score.verdict)}>{verdictLabel(score.verdict)}</Badge>
        </span>

        <span className="flex items-baseline gap-2 mt-2">
          <span className="font-display text-[40px] font-bold tracking-[0.02em] leading-none">{score.totalRounded}</span>
          <span className="text-[length:var(--text-13)] text-[color:var(--on-dark-muted)]">/ 100</span>
        </span>

        <span className="mt-2.5 text-[length:var(--text-11-5)] text-[color:var(--on-dark-muted-strong)] leading-normal">
          {`${score.confidence.level} confidence · model v${score.modelVersion}`}
          {score.countsAreExact ? "" : " · counts are floors"}
        </span>

        {score.basisLabel ? <span className="block mt-2 text-[length:var(--text-11)] text-[color:var(--sky)] leading-[1.45]">{score.basisLabel}</span> : null}

        <p className="mt-2.5 mb-0 text-[length:var(--text-12-5)] text-[color:var(--on-dark-muted-strong)] leading-normal">{score.verdictStatement}</p>

        <span className="flex items-center justify-between gap-2 mt-3.5 pt-3 border-t border-[color:var(--on-dark-fill)] text-[length:var(--text-12-5)] font-semibold text-[color:var(--on-dark)] min-h-[24px]">
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
        <p className="text-[length:var(--text-11-5)] leading-normal py-[9px] px-2.5 rounded-md bg-slate-100 text-ink">
          Review analysis is still running, so the service-gap component may still gain points.{" "}
          {onRefresh ? (
            <button type="button" onClick={onRefresh} className="text-[length:var(--text-13-5)] font-semibold">
              Refresh the score
            </button>
          ) : null}
        </p>
      ) : null}

      {score.components.map((component) => (
        <ComponentRow key={component.id} component={component} />
      ))}

      <p className="mt-4 mb-0 pt-3.5 border-t border-[color:var(--border-default)] text-[length:var(--text-11)] leading-[1.6] text-[color:var(--m-muted-on-white)]">
        {`Scored under model v${score.modelVersion}, checklist v${score.checklistVersion}. `}
        {`${score.pointsAwarded.toFixed(2)} of ${score.pointsAvailable} points available`}
        {score.pointsAvailable === 100 ? "." : ", rescaled to 100."}
        {score.basisLabel ? ` ${score.basisLabel}.` : ""}
      </p>

      <div className="mt-4 mb-0 pt-3.5 border-t border-[color:var(--border-default)] text-[length:var(--text-11)] leading-[1.6] text-[color:var(--m-muted-on-white)]">
        <strong>{`Confidence: ${score.confidence.level}.`}</strong>
        {score.confidence.reasons.length > 0 ? (
          <ul className="mt-1.5 mb-0 pl-[18px] text-[length:var(--text-11)] leading-[1.6] text-[color:var(--m-muted-on-white)]">
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
    <div className="border-t border-[color:var(--border-default)] py-3.5 px-0 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="text-[length:var(--text-13-5)] font-semibold">{component.label}</span>
        <span className="font-display text-[length:var(--text-13-5)] font-bold tracking-[0.02em] flex-none">
          {component.included
            ? `${component.points.toFixed(1)} / ${component.available}`
            : "Not scored"}
        </span>
      </div>

      {component.included ? (
        <div className="h-1.5 rounded-full bg-slate-200 my-[9px] overflow-hidden" role="presentation">
          <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      ) : null}

      {/* Printed verbatim: it is written to be read aloud. */}
      <p className="m-0 text-[length:var(--text-12-5)] leading-[1.6] text-ink">{component.justification}</p>

      {component.included ? null : (
        <p className="mt-2 mb-0 text-[length:var(--text-11-5)] leading-normal text-[color:var(--m-muted-on-white)]">
          Excluded from both the score and the points available, rather than scored as zero — an
          unobserved site is not a bad site.
        </p>
      )}

      {component.parts.length > 0 ? (
        <ul className="list-none mt-2.5 mb-0 p-0 flex flex-col gap-1.5">
          {component.parts.map((part) => (
            <li key={part.id} className="flex items-baseline justify-between gap-2.5 text-[length:var(--text-11-5)] text-[color:var(--m-muted-on-white)] leading-[1.45]">
              <span>{part.detail || part.label}</span>
              <span className="flex-none font-semibold text-ink">
                {part.available === null
                  ? part.points.toFixed(1)
                  : `${part.points.toFixed(1)}/${part.available}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {component.flags.length > 0 ? (
        <div className="flex flex-col gap-[7px] mt-2.5">
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
  const base = "text-[length:var(--text-11-5)] leading-normal py-[9px] px-2.5 rounded-md text-ink";
  if (flag.severity === "hard") return `${base} bg-red-100`;
  if (flag.severity === "warning") return `${base} bg-blue-100`;
  return `${base} bg-slate-100`;
}

/**
 * What sits where the score goes before there is one.
 *
 * A blank space would read as "this site has no score"; this reads as "the
 * score has not been computed yet", which is what is true.
 */
export function ScorePending({ message }: { message: string }) {
  return (
    <section aria-label="Site score" className="bg-[var(--surface-card)] border border-dashed border-[color:var(--border-strong)] rounded-[18px] py-[18px] px-4 text-[length:var(--text-13)] leading-[1.55] text-[color:var(--m-muted-on-white)] text-center">
      {message}
    </section>
  );
}
