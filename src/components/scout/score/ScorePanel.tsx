"use client";

import { useState } from "react";
import type { ScoreResult } from "@/lib/scout/scoring/types";
import { Badge } from "@/components/scout/ui";
import { SectionLabel } from "@/components/scout/patterns";
import { confidenceLabel, verdictLabel, verdictTone } from "@/lib/scout/display/format";

const flagStyles: Record<string, string> = {
  info: "text-slate-500",
  warning: "text-slate-700",
  hard: "text-red-600 font-semibold",
};

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
 * from the D2 2x2 grid, scaled up; the verdict is a `Badge` in the green /
 * blue / red tones the design system already ships; the component bars use the
 * blue ramp (`--blue-100` track, `--blue-500` fill) that the comparison table
 * already uses to mark a winning value.
 *
 * ## The one rule this component enforces structurally
 *
 * **The number never renders without its breakdown.** Not "should not" --- the
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
      className={["bg-[var(--surface-card)] border border-[color:var(--border-default)] rounded-[18px] p-[18px] flex flex-col gap-4 font-sans", className].filter(Boolean).join(" ")}
      aria-labelledby="score-heading"
    >
      <div className="bg-[var(--black)] text-[color:var(--on-dark)] rounded-[16px] p-[22px] flex items-center justify-between gap-[18px] flex-wrap">
        <div className="flex flex-col gap-1.5">
          <div className="font-display text-[52px] font-bold leading-none tracking-normal">
            {score.totalRounded}
            <span className="text-[18px] text-[color:var(--on-dark-muted)] ml-1.5">/100</span>
          </div>
          <SectionLabel weight={700} onDark as="h2" className="tracking-[var(--tracking-section)]">
            <span id="score-heading">Site score</span>
          </SectionLabel>
        </div>
        <div className="flex flex-col items-end gap-2 text-right max-w-[260px]">
          <Badge tone={verdictTone(score.verdict)}>{verdictLabel(score.verdict)}</Badge>
          <div className="text-[length:var(--text-11-5)] text-[color:var(--on-dark-muted-strong)] tracking-[0.02em]">{confidenceLabel(score.confidence.level)}</div>
          {score.basis === "desk_only" ? (
            <div className="text-[length:var(--text-11)] leading-normal text-[color:var(--sky)] border border-[rgba(115,202,240,0.4)] rounded py-[5px] px-[9px]" data-testid="score-basis-label">
              {score.basisLabel}
            </div>
          ) : null}
        </div>
      </div>

      <p className="m-0 text-[length:var(--text-13-5)] leading-[1.7] text-slate-700">{score.verdictStatement}</p>

      {score.hardFlags.length > 0 ? (
        <div className="border border-red-500 bg-red-100 rounded-[12px] py-[13px] px-[15px] flex flex-col gap-[7px]" role="alert">
          <SectionLabel weight={700}>Must be read whatever the score says</SectionLabel>
          {score.hardFlags.map((flag) => (
            <p key={flag.code} className="m-0 text-[length:var(--text-12-5)] leading-[1.65] text-red-600">
              {flag.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <SectionLabel weight={700}>Where the points came from</SectionLabel>
        {score.components.map((component) => {
          const expanded = open === component.id;
          const pct =
            component.available > 0
              ? Math.max(0, Math.min(100, (component.points / component.available) * 100))
              : 0;
          return (
            <div key={component.id} className="border border-[color:var(--border-default)] rounded-[12px] overflow-hidden">
              <button
                type="button"
                className="w-full text-left bg-[var(--surface-card)] border-0 py-3 px-[13px] pb-[13px] cursor-pointer font-sans flex flex-col gap-[9px] hover:bg-slate-100"
                aria-expanded={expanded}
                aria-controls={`component-${component.id}`}
                onClick={() => setOpen(expanded ? null : component.id)}
              >
                <span className="flex items-center justify-between gap-2.5">
                  <span className="text-[length:var(--text-13)] font-semibold text-ink">{component.label}</span>
                  <span className="flex items-baseline gap-1.5 text-slate-500">
                    {component.included ? (
                      <>
                        <span className="font-display text-[length:var(--text-15)] font-bold text-ink">
                          {component.points.toFixed(1)}
                        </span>
                        <span className="text-[length:var(--text-11-5)]">
                          /{component.available.toFixed(0)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[length:var(--text-11)] font-semibold tracking-[0.08em] uppercase text-slate-500">Excluded</span>
                    )}
                    <Chevron open={expanded} />
                  </span>
                </span>
                <span
                  className={component.included ? "block h-2 rounded-full bg-blue-100 overflow-hidden" : "block h-2 rounded-full bg-transparent border border-dashed border-[color:var(--border-strong)]"}
                  role="img"
                  aria-label={
                    component.included
                      ? `${component.points.toFixed(1)} of ${component.available.toFixed(0)} points`
                      : "Excluded from the total and from the denominator"
                  }
                >
                  {component.included ? (
                    <span className="block h-full rounded-full bg-blue-500 transition-[width] duration-[var(--dur-med)] ease-[var(--ease-standard)] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
                  ) : null}
                </span>
              </button>

              <div
                id={`component-${component.id}`}
                className="border-t border-[color:var(--border-default)] p-[13px] flex flex-col gap-[11px] bg-slate-100 motion-reduce:!animate-none"
                style={{ animation: "ssIn var(--dur-med) var(--ease-standard)" }}
                hidden={!expanded}
              >
                <p className="m-0 text-[length:var(--text-12-5)] leading-[1.7] text-slate-700">{component.justification}</p>

                {component.parts.length > 0 ? (
                  <ul className="list-none m-0 p-0 flex flex-col gap-[7px]">
                    {component.parts.map((part) => (
                      <li key={part.id} className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-0.5 text-[length:var(--text-11-5)]">
                        <span className="font-semibold text-ink">{part.label}</span>
                        <span className="font-display font-bold text-blue-700">
                          {part.available === null
                            ? part.points.toFixed(2)
                            : `${part.points.toFixed(1)}/${part.available.toFixed(0)}`}
                        </span>
                        <span className="col-span-full text-slate-500 leading-[1.6]">{part.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {component.flags.length > 0 ? (
                  <ul className="list-none m-0 p-0 flex flex-col gap-1.5 text-[length:var(--text-11-5)] leading-[1.6]">
                    {component.flags.map((flag) => (
                      <li key={flag.code} className={flagStyles[flag.severity] ?? "text-slate-500"}>
                        {flag.message}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-1 text-[length:var(--text-11)] text-slate-500 border-t border-[color:var(--border-default)] pt-2.5">
                  {Object.entries(component.inputs).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="m-0">{humanise(key)}</dt>
                      <dd className="m-0 text-right font-display text-slate-700">{renderInput(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          );
        })}
      </div>

      {score.confidence.reasons.length > 0 ? (
        <div className="flex flex-col gap-[7px]">
          <SectionLabel weight={700}>
            Why confidence is {score.confidence.level}
          </SectionLabel>
          <ul className="m-0 pl-[18px] text-[length:var(--text-12-5)] leading-[1.7] text-slate-500">
            {score.confidence.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className="border-t border-[color:var(--border-default)] pt-3 text-[length:var(--text-11)] text-slate-500 leading-[1.6] flex flex-col gap-1.5">
        <span>
          Model v{score.modelVersion} · checklist v{score.checklistVersion}
          {scoredAt ? ` · scored ${new Date(scoredAt).toLocaleString("en-GB")}` : ""} ·{" "}
          {score.pointsAwarded.toFixed(1)} of {score.pointsAvailable.toFixed(0)} points available
        </span>
        {themesPending ? (
          <span className="text-blue-700">
            Review analysis is still running, so the service-gap component may rise.{" "}
            {onRefresh ? (
              <button type="button" className="bg-transparent border-0 p-0 font-[inherit] text-[color:var(--accent)] cursor-pointer underline" onClick={onRefresh}>
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
      className={`self-center transition-transform duration-150 ease-[var(--ease-standard)] text-slate-500 motion-reduce:transition-none${open ? " rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** `benchmarkSampleCount` -> "Benchmark sample count". */
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
