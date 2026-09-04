"use client";

import { useMemo } from "react";
import {
  CHECKLIST_GROUPS,
  CHECKLIST_MAX_RATING,
  CHECKLIST_VERSION,
  SURVEYOR_CHECKLIST,
} from "@/lib/scout/scoring/checklist";
import { SectionLabel } from "@/components/scout/patterns";

export interface SurveyorChecklistProps {
  /** Sparse: an unanswered field is absent, never 0. */
  answers: Readonly<Record<string, number>>;
  onChange: (fieldId: string, rating: number | null) => void;
  /** Fields below this count leave the score `desk_only`. */
  minAnsweredFields?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * The surveyor checklist, rendered **generically** from Phase 3's definitions.
 *
 * `SURVEYOR_CHECKLIST` and `CHECKLIST_GROUPS` are imported and iterated; not a
 * single field label appears in this file. Phase 5 renders the same definitions
 * on the phone, and two hand-rolled copies drift inside a sprint — a drifted
 * label on a printed report is a number the salesperson cannot explain. Adding
 * a fifteenth field is an edit to `checklist.ts` and nothing else.
 *
 * ## The anchors are the point
 *
 * Each field renders its four **anchor descriptions**, not a bare 0–3 slider.
 * "Narrow lane" and "Wide frontage on a main road" are what make two surveyors
 * score the same plot alike; a slider labelled 0 to 3 makes them score it by
 * mood.
 *
 * ## Absent is not zero
 *
 * There is no default selection, and every field has a "Clear" control. Zero is
 * the worst possible observation — "night play prohibited" — so a field nobody
 * answered must stay absent rather than being submitted as 0, which would score
 * an unvisited corner of a site as a disastrous one.
 */
export function SurveyorChecklist({
  answers,
  onChange,
  minAnsweredFields = 4,
  disabled = false,
  className,
}: SurveyorChecklistProps) {
  const answered = useMemo(
    () => SURVEYOR_CHECKLIST.filter((f) => typeof answers[f.id] === "number").length,
    [answers],
  );

  return (
    <div className={["flex flex-col gap-4 font-sans", className].filter(Boolean).join(" ")}>
      <div className="flex items-baseline justify-between gap-2.5">
        <SectionLabel weight={700}>Site survey</SectionLabel>
        <span className="font-display text-[length:var(--text-13)] font-bold text-ink">
          {answered} of {SURVEYOR_CHECKLIST.length} answered
        </span>
      </div>
      <p className="m-0 text-[length:var(--text-11-5)] leading-[1.65] text-slate-500">
        {answered === 0
          ? `Nothing recorded yet. Below ${minAnsweredFields} answers the score stays desk-only: the site-practicals component is excluded and the remaining 85 points are rescaled to 100, which makes it non-comparable with a surveyed site.`
          : answered < minAnsweredFields
            ? `${minAnsweredFields - answered} more ${minAnsweredFields - answered === 1 ? "answer" : "answers"} and this stops being a desk-only score.`
            : `Scored over the ${answered} answered ${answered === 1 ? "field" : "fields"}, with the weights renormalised. Leave a field blank if you did not see it — blank is not zero.`}
      </p>

      {CHECKLIST_GROUPS.map((group) => {
        const fields = SURVEYOR_CHECKLIST.filter((f) => f.group === group.id);
        if (fields.length === 0) return null;
        return (
          <fieldset key={group.id} className="border border-[color:var(--border-default)] rounded-lg p-3.5 m-0 flex flex-col gap-3">
            <legend className="text-[length:var(--text-11)] font-bold tracking-[var(--tracking-section)] uppercase text-slate-500 py-0 px-1.5">{group.label}</legend>
            <p className="m-0 text-[length:var(--text-11-5)] leading-[1.6] text-slate-500">{group.description}</p>

            {fields.map((field) => {
              const value = answers[field.id];
              const name = `survey-${field.id}`;
              return (
                <div key={field.id} className="border-t border-[color:var(--border-default)] pt-3 flex flex-col gap-[7px] [&:first-of-type]:border-t-0 [&:first-of-type]:pt-0" role="group" aria-labelledby={`${name}-label`}>
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="text-[length:var(--text-13)] font-semibold text-ink" id={`${name}-label`}>
                      {field.label}
                    </span>
                    <button
                      type="button"
                      className="bg-transparent border-0 p-0 font-sans text-[length:var(--text-10-5)] tracking-[0.06em] uppercase text-slate-500 cursor-pointer disabled:opacity-[0.35] disabled:cursor-not-allowed hover:enabled:text-[color:var(--accent)]"
                      onClick={() => onChange(field.id, null)}
                      disabled={disabled || typeof value !== "number"}
                    >
                      Clear
                    </button>
                  </div>
                  <p className="m-0 text-[length:var(--text-11-5)] leading-[1.6] text-slate-500">{field.help}</p>
                  <div className="flex flex-col gap-[5px]">
                    {field.anchors.map((anchor, rating) => (
                      <label
                        key={anchor}
                        className={value === rating
                          ? "flex items-center gap-[9px] border border-[color:var(--accent)] bg-blue-100 rounded-md py-2 px-[11px] cursor-pointer text-[length:var(--text-12-5)] text-blue-700 font-semibold transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)]"
                          : "flex items-center gap-[9px] border border-[color:var(--border-default)] rounded-md py-2 px-[11px] cursor-pointer text-[length:var(--text-12-5)] text-slate-700 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)] hover:bg-slate-100"
                        }
                      >
                        <input
                          type="radio"
                          name={name}
                          value={rating}
                          checked={value === rating}
                          disabled={disabled}
                          onChange={() => onChange(field.id, rating)}
                          className="w-3.5 h-3.5 accent-[var(--accent)] flex-none m-0"
                        />
                        <span className={`font-display text-[length:var(--text-11)] font-bold flex-none w-3 ${value === rating ? "text-blue-700" : "text-slate-500"}`}>{rating}</span>
                        <span className="leading-[1.4]">{anchor}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </fieldset>
        );
      })}

      <p className="m-0 text-[length:var(--text-10-5)] text-slate-500">
        Checklist v{CHECKLIST_VERSION} · each field rated 0–{CHECKLIST_MAX_RATING} · together worth
        15 of the 100 points
      </p>
    </div>
  );
}
