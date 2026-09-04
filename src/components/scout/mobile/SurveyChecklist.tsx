"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2.5 text-[length:var(--text-11-5)] text-[color:var(--m-muted)]">
        <span>{`${answered} of ${totalFields} observations recorded`}</span>
        <span>{`Checklist v${checklist.checklistVersion}`}</span>
      </div>
      <div
        className="h-1.5 rounded-full bg-slate-200 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalFields}
        aria-valuenow={answered}
        aria-label="Checklist completion"
      >
        <span
          className="block h-full bg-green-500 rounded-full transition-[width] duration-[var(--dur-med)] ease-[var(--ease-standard)]"
          style={{ width: `${totalFields === 0 ? 0 : (answered / totalFields) * 100}%` }}
        />
      </div>

      {status ? (
        <p
          className={[
            "text-[length:var(--text-11-5)] leading-normal",
            statusIsError ? "text-red-600" : "text-[color:var(--m-muted)]",
          ].join(" ")}
          role="status"
        >
          {status}
        </p>
      ) : null}

      {checklist.groups.map((group) => {
        const open = openGroups[group.id] ?? false;
        const groupAnswered = group.fields.filter((f) => f.id in answers).length;

        return (
          <section className="bg-[var(--surface-card)] border border-[color:var(--border-default)] rounded-lg overflow-hidden" key={group.id}>
            <button
              type="button"
              className="flex items-center justify-between gap-2.5 w-full text-left bg-[var(--surface-card)] border-0 p-3.5 min-h-[var(--m-touch)] cursor-pointer font-sans"
              aria-expanded={open}
              onClick={() => setOpenGroups((s) => ({ ...s, [group.id]: !open }))}
            >
              <span className="text-[length:var(--text-13-5)] font-semibold text-ink">
                {group.label}
                <span className="block text-[length:var(--text-11-5)] font-normal text-[color:var(--m-muted-on-white)] mt-[3px] leading-[1.45]">{group.description}</span>
              </span>
              <span className="flex-none text-[length:var(--text-11-5)] text-[color:var(--m-muted-on-white)]">{`${groupAnswered}/${group.fields.length}`}</span>
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
    <div className="border-t border-[color:var(--border-default)] p-3.5">
      <fieldset className="flex flex-col gap-1.5 border-0 m-0 p-0">
        <legend className="text-[length:var(--text-13)] font-semibold text-ink">{field.label}</legend>
        <p className="mt-1 mb-2.5 text-[length:var(--text-11-5)] leading-normal text-[color:var(--m-muted-on-white)]">{field.help}</p>

        {field.anchors.map((anchor, rating) => (
          <label
            key={anchor}
            className={value === rating
              ? "flex items-center gap-2.5 min-h-[var(--m-touch)] py-2 px-[11px] border border-[color:var(--accent)] bg-blue-100 rounded-md text-[length:var(--text-12-5)] leading-[1.4] text-ink cursor-pointer font-semibold"
              : "flex items-center gap-2.5 min-h-[var(--m-touch)] py-2 px-[11px] border border-[color:var(--border-strong)] rounded-md text-[length:var(--text-12-5)] leading-[1.4] text-ink cursor-pointer bg-[var(--surface-card)]"
            }
          >
            <input
              className="flex-none w-[18px] h-[18px] accent-[var(--accent)]"
              type="radio"
              name={name}
              value={rating}
              checked={value === rating}
              disabled={disabled}
              onChange={() => onSet(rating)}
            />
            <span className="flex-none font-display text-[length:var(--text-11)] font-bold text-[color:var(--m-muted-on-white)]">{rating}</span>
            <span>{anchor}</span>
          </label>
        ))}
      </fieldset>

      {value === undefined ? null : (
        <button type="button" className="self-start mt-2 bg-transparent border-0 py-2 px-0 min-h-[var(--m-touch)] font-sans text-[length:var(--text-11-5)] text-[color:var(--accent)] cursor-pointer underline" onClick={() => onSet(null)} disabled={disabled}>
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
