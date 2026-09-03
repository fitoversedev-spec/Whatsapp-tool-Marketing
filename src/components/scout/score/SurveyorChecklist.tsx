"use client";

import { useMemo } from "react";
import {
  CHECKLIST_GROUPS,
  CHECKLIST_MAX_RATING,
  CHECKLIST_VERSION,
  SURVEYOR_CHECKLIST,
} from "@/lib/scout/scoring/checklist";
import { SectionLabel } from "@/components/scout/patterns";
import styles from "./SurveyorChecklist.module.css";

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
    <div className={[styles.checklist, className].filter(Boolean).join(" ")}>
      <div className={styles.progress}>
        <SectionLabel weight={700}>Site survey</SectionLabel>
        <span className={styles.progressCount}>
          {answered} of {SURVEYOR_CHECKLIST.length} answered
        </span>
      </div>
      <p className={styles.progressNote}>
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
          <fieldset key={group.id} className={styles.group}>
            <legend className={styles.legend}>{group.label}</legend>
            <p className={styles.groupDescription}>{group.description}</p>

            {fields.map((field) => {
              const value = answers[field.id];
              const name = `survey-${field.id}`;
              return (
                <div key={field.id} className={styles.field} role="group" aria-labelledby={`${name}-label`}>
                  <div className={styles.fieldHead}>
                    <span className={styles.fieldLabel} id={`${name}-label`}>
                      {field.label}
                    </span>
                    <button
                      type="button"
                      className={styles.clear}
                      onClick={() => onChange(field.id, null)}
                      disabled={disabled || typeof value !== "number"}
                    >
                      Clear
                    </button>
                  </div>
                  <p className={styles.help}>{field.help}</p>
                  <div className={styles.anchors}>
                    {field.anchors.map((anchor, rating) => (
                      <label
                        key={anchor}
                        className={[styles.anchor, value === rating && styles.anchorOn]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <input
                          type="radio"
                          name={name}
                          value={rating}
                          checked={value === rating}
                          disabled={disabled}
                          onChange={() => onChange(field.id, rating)}
                          className={styles.radio}
                        />
                        <span className={styles.anchorRating}>{rating}</span>
                        <span className={styles.anchorText}>{anchor}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </fieldset>
        );
      })}

      <p className={styles.version}>
        Checklist v{CHECKLIST_VERSION} · each field rated 0–{CHECKLIST_MAX_RATING} · together worth
        15 of the 100 points
      </p>
    </div>
  );
}
