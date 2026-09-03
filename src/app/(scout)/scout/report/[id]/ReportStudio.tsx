"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { SiteMap, type SiteMapMarker } from "@/components/scout/map";
import { SaturationPanel, ScorePanel, SurveyorChecklist } from "@/components/scout/score";
import {
  atLeast,
  formatCount,
  formatDistance,
  formatFullDate,
  formatRadius,
  formatRating,
  verdictLabel,
  verdictTone,
} from "@/lib/scout/display/format";
import { POPULATION_LIMITATION_TEXT, populationLimitations } from "@/lib/scout/census/disclosure";
import { REPORT_BLOCKS, TOGGLEABLE_REPORT_BLOCKS, type ReportBlockState } from "@/lib/scout/reports/blocks";
import { deliveryNote, reportDelivery } from "@/lib/scout/reports/delivery";
import type { ScanScreenData } from "@/lib/scout/scans/dto";
import type { ScoreResult } from "@/lib/scout/scoring/types";
import { markedCells, sweepStatusLabel, type SweepDocument } from "@/lib/scout/sweep/grid";
import styles from "./Report.module.css";

/** The `reports` row as the generate endpoint returns it. */
export interface GeneratedReport {
  id: string;
  version: number;
  status: string;
  error: string | null;
  pdfBytes: number | null;
  pageCount: number | null;
  generatedAt: string | null;
  expiresAt: string | null;
  scoreModelVersion: string | null;
  sentTo: string | null;
  link: { url: string; expiresOnLabel: string } | null;
}

export interface ShareResponse {
  /** `null` under a delivery implementation that sends for itself. */
  whatsappUrl: string | null;
  mode: "handoff" | "sent";
  deliveryNote: string;
  message: string;
  link: { url: string; expiresOnLabel: string };
  recipientName: string | null;
}

export interface ReportStudioProps {
  scan: ScanScreenData;
  sweep: SweepDocument | null;
  initialBlocks: ReportBlockState;
  initialNotes: string;
  preparedBy: string;
  initialReport: GeneratedReport | null;
}

const SAVE_DEBOUNCE_MS = 600;
/**
 * What the button does, before a share has told us.
 *
 * Resolved from the installed delivery implementation rather than written into
 * the screen, so swapping `wa.me` for the host's WhatsApp Cloud API changes
 * this sentence without anybody remembering to.
 */
const DELIVERY_NOTE = deliveryNote(reportDelivery().mode);
/** How often the studio asks whether the background render has finished. */
const GENERATE_POLL_MS = 2_000;
const GENERATE_POLL_LIMIT = 60;

/**
 * D5 — the report studio.
 *
 * ## The checklist is the scoreable input
 *
 * The mockup has a single free-text notes box. Free text cannot be scored, and
 * component 5 of the site score — 15 of the 100 points — is exactly the
 * surveyor's observations. So the checklist sits above the notes and the notes
 * stay for colour: "parking is dreadful" is a rating, "the watchman said the
 * owner is in Dubai until March" is not.
 *
 * The form is rendered generically from Phase 3's field definitions. Not one
 * field label appears in this file.
 *
 * ## Generate is a stub, deliberately
 *
 * PDF rendering and WhatsApp delivery belong to Phase 6. The buttons are here
 * because the screen's layout depends on them, and they say plainly that they
 * are not wired rather than producing a broken file.
 */
export function ReportStudio({
  scan,
  sweep,
  initialBlocks,
  initialNotes,
  preparedBy,
  initialReport,
}: ReportStudioProps) {
  const [blocks, setBlocks] = useState<ReportBlockState>(initialBlocks);
  const [notes, setNotes] = useState(initialNotes);
  const [answers, setAnswers] = useState<Record<string, number>>({ ...scan.surveyorInputs });
  const [score, setScore] = useState<ScoreResult | null>(scan.score);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [surveyState, setSurveyState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [rescoreNeeded, setRescoreNeeded] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------------------------------------------------- report generation */

  const [report, setReport] = useState<GeneratedReport | null>(initialReport);
  const [generating, setGenerating] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [sharing, setSharing] = useState(false);

  /* -------------------------------------------------- draft autosave */

  /**
   * Autosave only what actually changed.
   *
   * A "first render" ref is not enough: React StrictMode double-invokes effects
   * in development, so the second pass would slip past it and write the state
   * the screen was loaded with. Comparing against the loaded value means
   * opening the studio never writes a row, and reopening it never touches
   * `updatedAt`.
   */
  const loadedDraft = useRef(JSON.stringify({ blocks: initialBlocks, notes: initialNotes }));
  useEffect(() => {
    if (JSON.stringify({ blocks, notes }) === loadedDraft.current) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/scout/scans/${scan.scanId}/report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ includedBlocks: blocks, fieldNotes: notes }),
        });
        setSaveState(res.ok ? "saved" : "error");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setSaveState("error");
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [blocks, notes, scan.scanId]);

  /* ----------------------------------------------- survey save + rescore */

  const loadedAnswers = useRef(JSON.stringify(scan.surveyorInputs));
  useEffect(() => {
    if (JSON.stringify(answers) === loadedAnswers.current) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSurveyState("saving");
      try {
        const res = await fetch(`/api/scout/scans/${scan.scanId}/survey`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ answers }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { rescoreRequired?: boolean; rejected?: string[] };
        setSurveyState("saved");
        // The endpoint says so itself: observations do not reach the score
        // until it is recomputed, and silently rescoring behind the surveyor
        // would change a number they may already have quoted.
        if (json.rescoreRequired) setRescoreNeeded(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setSurveyState("error");
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [answers, scan.scanId]);

  const rescore = useCallback(async () => {
    setScoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/scout/scans/${scan.scanId}/score`, { method: "POST" });
      const json = (await res.json()) as { score?: ScoreResult; error?: string };
      if (res.ok && json.score) {
        setScore(json.score);
        setRescoreNeeded(false);
      } else {
        setError(json.error ?? "The score could not be recomputed.");
      }
    } catch {
      setError("The scoring request failed. Try again in a moment.");
    } finally {
      setScoring(false);
    }
  }, [scan.scanId]);

  /* --------------------------------------------------------- generation */

  /**
   * Generate, then poll.
   *
   * The POST returns a `generating` row and the render happens after the
   * response. Polling rather than streaming because the render is seconds long
   * and the answer is one of three words — a websocket for that would be a
   * moving part with nothing to carry.
   */
  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setShare(null);
    try {
      const res = await fetch(`/api/scout/scans/${scan.scanId}/report/generate`, { method: "POST" });
      const json = (await res.json()) as { report?: GeneratedReport; error?: string };
      if (!res.ok || !json.report) {
        setError(json.error ?? "The report could not be started.");
        setGenerating(false);
        return;
      }
      setReport(json.report);

      for (let attempt = 0; attempt < GENERATE_POLL_LIMIT; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, GENERATE_POLL_MS));
        const poll = await fetch(`/api/scout/scans/${scan.scanId}/report/generate`);
        if (!poll.ok) continue;
        const state = (await poll.json()) as { report?: GeneratedReport | null };
        if (!state.report) continue;
        setReport(state.report);
        if (state.report.status !== "generating") {
          // The failure text is written on the row by the worker, so the
          // screen shows what actually went wrong rather than "something did".
          if (state.report.status === "failed") setError(state.report.error);
          break;
        }
      }
    } catch {
      setError("The report request failed. Nothing has been sent.");
    } finally {
      setGenerating(false);
    }
  }, [scan.scanId]);

  /**
   * Log the hand-over, then open WhatsApp.
   *
   * The share is recorded *before* the window opens: the salesperson is about
   * to leave the screen, and a log written on return is a log that is missing
   * every time they do not come back.
   */
  const shareOnWhatsApp = useCallback(async () => {
    if (!report) return;
    setSharing(true);
    setError(null);
    try {
      const res = await fetch(`/api/scout/reports/${report.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "whatsapp", recipientName: recipient }),
      });
      const json = (await res.json()) as ShareResponse & { error?: string };
      if (!res.ok || !json.link) {
        setError(json.error ?? "The share could not be recorded.");
        return;
      }
      setShare(json);
      setReport((prev) => (prev ? { ...prev, sentTo: json.recipientName } : prev));
      // A handoff needs the compose window opened. A delivery implementation
      // that sends for itself returns no URL, and opening one would be a lie.
      if (json.whatsappUrl) window.open(json.whatsappUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError("The share could not be recorded. Nothing has been sent.");
    } finally {
      setSharing(false);
    }
  }, [report, recipient]);

  const setAnswer = useCallback((fieldId: string, rating: number | null) => {
    setAnswers((prev) => {
      const next = { ...prev };
      // Absent, never zero: a field nobody answered must not be scored as the
      // worst possible observation.
      if (rating === null) delete next[fieldId];
      else next[fieldId] = rating;
      return next;
    });
  }, []);

  /* --------------------------------------------------------- derived */

  const on = useCallback((id: string) => blocks[id] === true, [blocks]);

  const markers = useMemo<SiteMapMarker[]>(
    () =>
      scan.places.slice(0, 120).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        type: p.side === "competition" ? "facility" : "demand",
      })),
    [scan.places],
  );

  const sweepMarked = useMemo(() => (sweep ? markedCells(sweep.cells) : []), [sweep]);
  const limitations = populationLimitations();

  return (
    <div className={`${styles.split} ssIn`}>
      <aside className={`${styles.panel} ss-scroll`}>
        <div>
          <h1 className={styles.title}>Report studio</h1>
          <div className={styles.subtitle}>
            {scan.areaLabel} · {formatRadius(scan.radiusM)} · {formatFullDate(scan.scoredAt)}
          </div>
        </div>

        {/* ------------------------------------------- surveyor checklist */}
        <SurveyorChecklist answers={answers} onChange={setAnswer} />
        <div className={styles.saveState} aria-live="polite">
          {surveyState === "saving"
            ? "Saving the survey…"
            : surveyState === "saved"
              ? "Survey saved"
              : surveyState === "error"
                ? "The survey did not save. Your answers are still on screen."
                : ""}
        </div>

        {rescoreNeeded ? (
          <StateBlock
            eyebrow="Survey changed"
            title="The score has not moved yet"
            body="Observations do not reach the score until it is recomputed. The stored score is the one anyone has already been shown, so it is never changed behind you."
            action={
              <Button onClick={() => void rescore()} disabled={scoring}>
                {scoring ? "Recomputing…" : "Recompute the score"}
              </Button>
            }
          />
        ) : null}

        {error ? <StateBlock tone="error" title="Something failed" body={error} /> : null}

        {/* ------------------------------------------------- field notes */}
        <div className={styles.section}>
          <SectionLabel weight={700}>Field notes</SectionLabel>
          <textarea
            className={styles.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Field notes"
            placeholder="What you saw that the data can't — parking, lighting, drainage, footfall at 7pm."
          />
          <p className={styles.hint}>
            Colour for the report. The checklist above is what the score reads; this is what the
            customer reads.
          </p>
        </div>

        {/* ---------------------------------------------------- includes */}
        <div className={styles.section}>
          <SectionLabel weight={700}>Include</SectionLabel>
          {TOGGLEABLE_REPORT_BLOCKS.map((block) => (
            <label
              key={block.id}
              className={[styles.include, on(block.id) && styles.includeOn]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                type="checkbox"
                className={styles.includeCheck}
                checked={on(block.id)}
                onChange={(e) =>
                  setBlocks((prev) => ({ ...prev, [block.id]: e.target.checked }))
                }
              />
              <span className={styles.includeText}>
                <span>{block.label}</span>
                <span className={styles.includeHelp}>{block.help}</span>
              </span>
            </label>
          ))}
          <p className={styles.hint}>
            The area header and the limitations paragraph are always printed. The limitations
            paragraph is what stops a reader inferring a catchment population from a saturation
            figure, so it is not a composition choice.
          </p>
          <div className={styles.saveState} aria-live="polite">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Draft saved"
                : saveState === "error"
                  ? "The draft did not save."
                  : ""}
          </div>
        </div>

        <Button block onClick={() => void generate()} disabled={generating}>
          {generating
            ? "Producing the report…"
            : report?.status === "generated" || report?.status === "delivered"
              ? "Generate a new version"
              : "Generate report"}
        </Button>

        <a className={styles.meta} href={`/api/scout/scans/${scan.scanId}/report/preview`} target="_blank" rel="noreferrer">
          Open the full preview in a new tab
        </a>

        {generating ? (
          <p className={styles.meta} aria-live="polite">
            The PDF renders in the background, so you can keep working. It usually takes a few
            seconds; the first one after a deploy takes longer while the renderer starts.
          </p>
        ) : null}

        {report && (report.status === "generated" || report.status === "delivered") && report.link ? (
          <div className={styles.generated}>
            <p className={styles.meta}>
              Version {report.version} ready
              {report.pdfBytes ? ` · ${(report.pdfBytes / 1024 / 1024).toFixed(2)} MB` : ""}
              {report.pageCount ? ` · ${report.pageCount} pages` : ""}
              {report.scoreModelVersion ? ` · score model v${report.scoreModelVersion}` : ""}. The
              link works until {report.link.expiresOnLabel}.
            </p>

            <input
              className={styles.recipient}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              aria-label="Who are you sending it to?"
              placeholder="Who are you sending it to? (e.g. Deepa)"
            />

            <button
              type="button"
              className={styles.whatsapp}
              onClick={() => void shareOnWhatsApp()}
              disabled={sharing}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12.04 2C6.6 2 2.2 6.4 2.2 11.84c0 1.94.55 3.75 1.5 5.29L2 22l5-1.63a9.8 9.8 0 0 0 5.04 1.38h.01c5.43 0 9.84-4.4 9.84-9.84S17.47 2 12.04 2zm5.72 13.96c-.24.68-1.4 1.3-1.94 1.34-.5.04-.98.22-3.3-.69-2.78-1.1-4.55-3.93-4.69-4.11-.14-.19-1.12-1.49-1.12-2.84 0-1.35.71-2.02.96-2.29.25-.27.55-.34.73-.34h.53c.17 0 .4-.06.62.48.24.57.8 1.97.87 2.11.07.14.12.3.02.49-.1.19-.15.3-.29.47-.14.16-.3.36-.43.49-.14.14-.29.29-.13.57.17.27.74 1.22 1.58 1.97 1.09.97 2 1.27 2.28 1.41.28.14.44.12.6-.07.17-.19.7-.81.88-1.09.19-.27.37-.23.62-.14.25.09 1.6.75 1.87.89.27.14.46.2.53.31.07.12.07.66-.17 1.34z" />
              </svg>
              {sharing ? "Recording the share…" : "Share on WhatsApp"}
            </button>

            <Button variant="secondary" block onClick={() => window.open(report.link!.url, "_blank", "noopener,noreferrer")}>
              Open the PDF
            </Button>

            <div className={styles.linkBox}>
              <a href={report.link.url} target="_blank" rel="noreferrer">
                {report.link.url}
              </a>
            </div>

            <p className={styles.stubNote}>
              {share?.deliveryNote ?? DELIVERY_NOTE} The link expires on{" "}
              {report.link.expiresOnLabel}; regenerating produces a new one and leaves this version
              readable until then.
            </p>

            {share ? (
              <p className={styles.meta} aria-live="polite">
                Logged{share.recipientName ? ` as sent to ${share.recipientName}` : ""}. This scan
                now shows as “Report sent” on the dashboard.
              </p>
            ) : null}
          </div>
        ) : null}

        {report?.status === "failed" ? (
          <StateBlock
            tone="error"
            eyebrow="Not generated"
            title="The PDF could not be produced"
            body={
              report.error ??
              "The renderer failed and did not say why. Nothing has been sent to anyone."
            }
            action={
              <Button variant="secondary" onClick={() => void generate()}>
                Try again
              </Button>
            }
          />
        ) : null}
      </aside>

      {/* ------------------------------------------------- paper preview */}
      <div className={`${styles.canvas} ss-scroll`}>
        <article className={styles.paper} aria-label="Report preview">
          <div className={styles.paperHead}>
            <div className={styles.paperBrand}>
              <svg className={styles.paperMark} viewBox="0 0 28 28" aria-hidden="true">
                <defs>
                  <linearGradient id="ss-report-mark" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--green)" />
                    <stop offset="45%" stopColor="var(--sky)" />
                    <stop offset="80%" stopColor="var(--navy)" />
                    <stop offset="100%" stopColor="var(--red)" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width="28" height="28" rx="7" fill="url(#ss-report-mark)" />
              </svg>
              <span className={styles.paperWordmark}>Site Scout report</span>
            </div>
            <span className={styles.paperDate}>{formatFullDate(new Date())}</span>
          </div>

          <div>
            <div className={styles.paperAreaLabel}>Area</div>
            <div className={styles.paperArea}>
              {scan.areaLabel} — {formatRadius(scan.radiusM)} radius
            </div>
          </div>

          {score ? (
            <div>
              <div className={styles.paperAreaLabel}>Verdict</div>
              <div style={{ marginTop: 8 }}>
                <Badge tone={verdictTone(score.verdict)}>
                  {verdictLabel(score.verdict)} · {score.totalRounded}/100
                </Badge>
              </div>
            </div>
          ) : null}

          {on("stat-cards") ? (
            <div className={styles.paperStats}>
              <div className={styles.paperStat}>
                <div className={styles.paperStatValue}>
                  {atLeast(scan.competitionCount, scan.anySaturated)}
                </div>
                <div className={styles.paperStatLabel}>Facilities</div>
              </div>
              <div className={styles.paperStat}>
                <div className={styles.paperStatValue}>{formatCount(scan.reviewTotal)}</div>
                <div className={styles.paperStatLabel}>Reviews</div>
              </div>
              <div className={styles.paperStat}>
                <div className={styles.paperStatValue}>{formatRating(scan.avgRating)}</div>
                <div className={styles.paperStatLabel}>Avg rating</div>
              </div>
              <div className={styles.paperStatDark}>
                <div className={styles.paperStatValue}>
                  {atLeast(scan.demandCount, scan.anySaturated)}
                </div>
                <div className={styles.paperStatLabel}>Demand places</div>
              </div>
            </div>
          ) : null}

          {on("score") && score ? (
            <ScorePanel score={score} scoredAt={scan.scoredAt} />
          ) : null}

          {on("saturation") && score ? (
            <SaturationPanel
              score={score}
              radiusM={scan.radiusM}
              saturatedTerms={scan.saturatedTerms}
            />
          ) : null}

          {on("count-table") && scan.categories.length > 0 ? (
            <div className={styles.paperTable}>
              <div className={styles.paperTableHead}>
                <span>Category</span>
                <span className={styles.right}>Count</span>
                <span className={styles.right}>Reviews</span>
                <span className={styles.right}>Nearest</span>
              </div>
              {scan.categories.map((c) => (
                <div key={c.categoryId} className={styles.paperTableRow}>
                  <span>{c.label}</span>
                  <span className={styles.right}>{atLeast(c.count, c.saturated)}</span>
                  <span className={styles.rightMuted}>
                    {c.reviewTotal > 0 ? formatCount(c.reviewTotal) : "—"}
                  </span>
                  <span className={styles.rightMuted}>
                    {c.nearestM === null ? "—" : formatDistance(c.nearestM)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {on("map") ? (
            <div className={styles.paperMap}>
              <SiteMap
                lat={scan.centre.lat}
                lng={scan.centre.lng}
                radius={scan.radiusM / 1000}
                markers={markers}
                ariaLabel={`Catchment map for ${scan.areaLabel}`}
              />
            </div>
          ) : null}

          {on("sweep") ? (
            <div>
              <div className={styles.paperAreaLabel}>Spaces sweep</div>
              {sweepMarked.length === 0 ? (
                <p className={styles.paperNotes}>
                  No cells were marked in the sweep of this area.
                </p>
              ) : (
                <div className={styles.paperSweep}>
                  {sweepMarked.map((cell) => (
                    <div key={cell.id}>
                      <strong>
                        {cell.id} · {sweepStatusLabel(cell.status)}
                      </strong>
                      {cell.note ? ` — ${cell.note}` : ""}
                    </div>
                  ))}
                  <p className={styles.paperLimitations}>
                    Marked from satellite imagery only. Imagery is typically one to three years old.
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {on("field-notes") ? (
            <div>
              <div className={styles.paperAreaLabel}>Field notes</div>
              <div className={styles.paperNotes}>
                {notes || "Field notes appear here as you type them."}
              </div>
            </div>
          ) : null}

          <div>
            <div className={styles.paperAreaLabel}>{limitations.heading}</div>
            {limitations.paragraphs.map((p) => (
              <p key={p} className={styles.paperLimitations}>
                {p}
              </p>
            ))}
            {!limitations.paragraphs.includes(POPULATION_LIMITATION_TEXT) ? (
              <p className={styles.paperLimitations}>{POPULATION_LIMITATION_TEXT}</p>
            ) : null}
          </div>

          <div className={styles.paperFoot}>
            Prepared by {preparedBy} · Fitoverse · Data from public listings
            {score ? ` · scored under model v${score.modelVersion}` : ""}
            {scan.anySaturated
              ? " · counts marked “at least” are floors: a search returned the maximum results a single query can"
              : ""}
            . This report contains no projection of revenue or return.
          </div>
        </article>
      </div>
    </div>
  );
}

/** Exported so the handoff can name the blocks without re-listing them. */
export const REPORT_BLOCK_COUNT = REPORT_BLOCKS.length;
