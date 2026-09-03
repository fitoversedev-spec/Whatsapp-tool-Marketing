"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./SurveyChecklist.module.css";

/**
 * The checklist payload served by `GET /api/scout/scans/{id}/survey`.
 *
 * Typed here to describe the wire shape, **not** to restate the fields. The
 * route builds this from `SURVEYOR_CHECKLIST` in `src/lib/scoring/checklist.ts`,
 * which is Phase 3's single definition, so a fifteenth field appears on this
 * form with no change to this file. That is the whole point: two hand-rolled
 * copies drift within a sprint, and a drifted label on a printed report is a
 * number the salesperson cannot explain.
 */
export interface ChecklistPayload {
  readonly checklistVersion: string;
  readonly maxRating: number;
  readonly groups: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly fields: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly help: string;
      readonly anchors: readonly string[];
    }>;
  }>;
  readonly answers: Readonly<Record<string, number>>;
  readonly answeredCount: number;
}

export interface SurveyChecklistProps {
  checklist: ChecklistPayload;
  answers: Readonly<Record<string, number>>;
  /** Called on every change. The parent owns saving and rescoring. */
  onChange: (answers: Record<string, number>) => void;
  /** "Saved", "Saving…", or an error. */
  status?: string | null;
  statusIsError?: boolean;
  disabled?: boolean;
}

/**
 * The surveyor checklist, rendered generically.
 *
 * ## Why the anchors are rendered, not a slider
 *
 * A bare 0–3 control makes "parking: 2" mean whatever the surveyor privately
 * thought it meant. The four anchor sentences — "None possible", "Street only,
 * congested", "Some off-street space", "Dedicated space available" — are what
 * make two surveyors score the same plot alike, which is what makes the
 * fifteen points comparable between sites. Phase 3 says to render them; this
 * renders them as the radio labels themselves so there is nothing else to tap.
 *
 * ## Absent is not zero
 *
 * An unanswered field is **absent** from the payload, never sent as `0`. Zero
 * is the worst possible observation ("night play prohibited"), and conflating
 * "we didn't look" with "it's terrible" would make every unvisited corner of a
 * site score as a bad one. That is why each field carries a "Clear answer"
 * control rather than a zero-by-default position.
 */
export function SurveyChecklist({
  checklist,
  answers,
  onChange,
  status,
  statusIsError = false,
  disabled = false,
}: SurveyChecklistProps) {
  const totalFields = useMemo(
    () => checklist.groups.reduce((sum, g) => sum + g.fields.length, 0),
    [checklist],
  );
  const answered = Object.keys(answers).length;

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const first = checklist.groups[0]?.id;
    return first ? { [first]: true } : {};
  });

  function set(fieldId: string, rating: number | null) {
    const next = { ...answers };
    if (rating === null) delete next[fieldId];
    else next[fieldId] = rating;
    onChange(next);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.summary}>
        <span>{`${answered} of ${totalFields} observations recorded`}</span>
        <span>{`Checklist v${checklist.checklistVersion}`}</span>
      </div>
      <div
        className={styles.progress}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalFields}
        aria-valuenow={answered}
        aria-label="Checklist completion"
      >
        <span
          className={styles.progressFill}
          style={{ width: `${totalFields === 0 ? 0 : (answered / totalFields) * 100}%` }}
        />
      </div>

      {status ? (
        <p
          className={[styles.status, statusIsError && styles.statusError].filter(Boolean).join(" ")}
          role="status"
        >
          {status}
        </p>
      ) : null}

      {checklist.groups.map((group) => {
        const open = openGroups[group.id] ?? false;
        const groupAnswered = group.fields.filter((f) => f.id in answers).length;

        return (
          <section className={styles.group} key={group.id}>
            <button
              type="button"
              className={styles.groupHead}
              aria-expanded={open}
              onClick={() => setOpenGroups((s) => ({ ...s, [group.id]: !open }))}
            >
              <span className={styles.groupTitle}>
                {group.label}
                <span className={styles.groupDesc}>{group.description}</span>
              </span>
              <span className={styles.groupCount}>{`${groupAnswered}/${group.fields.length}`}</span>
            </button>

            {open
              ? group.fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    value={answers[field.id]}
                    disabled={disabled}
                    onSet={(rating) => set(field.id, rating)}
                  />
                ))
              : null}
          </section>
        );
      })}
    </div>
  );
}

function FieldRow({
  field,
  value,
  disabled,
  onSet,
}: {
  field: ChecklistPayload["groups"][number]["fields"][number];
  value: number | undefined;
  disabled: boolean;
  onSet: (rating: number | null) => void;
}) {
  const name = `survey-${field.id}`;

  return (
    <div className={styles.field}>
      <fieldset className={styles.anchors}>
        <legend className={styles.fieldLabel}>{field.label}</legend>
        <p className={styles.fieldHelp}>{field.help}</p>

        {field.anchors.map((anchor, rating) => (
          <label
            key={anchor}
            className={[styles.anchor, value === rating && styles.anchorSelected]
              .filter(Boolean)
              .join(" ")}
          >
            <input
              className={styles.radio}
              type="radio"
              name={name}
              value={rating}
              checked={value === rating}
              disabled={disabled}
              onChange={() => onSet(rating)}
            />
            <span className={styles.rating}>{rating}</span>
            <span>{anchor}</span>
          </label>
        ))}
      </fieldset>

      {value === undefined ? null : (
        <button type="button" className={styles.clear} onClick={() => onSet(null)} disabled={disabled}>
          {`Clear "${field.label}" — leave it unobserved`}
        </button>
      )}
    </div>
  );
}

/**
 * Save with a short debounce, so a surveyor tapping through four anchors in a
 * row makes one request instead of four — but short enough that walking away
 * from the phone never loses an answer.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
