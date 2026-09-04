"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  FieldHeader,
  StickyFooter,
  SurveyChecklist,
  apiFetch,
  ApiError,
  formatCount,
  formatDistance,
  formatNumber,
  formatRadius,
  formatRating,
  useDebounced,
  useOnline,
  type ChecklistPayload,
} from "@/components/scout/mobile";
import { SectionLabel } from "@/components/scout/patterns";
import { Button } from "@/components/scout/ui";
import { POPULATION_LIMITATION_TEXT } from "@/lib/scout/census/disclosure";
import { deliveryNote, reportDelivery } from "@/lib/scout/reports/delivery";
import type { ScanResult } from "@/lib/scout/places/scanResult";
import type { ScoreResult } from "@/lib/scout/scoring";

interface ScoreResponse {
  readonly score: ScoreResult;
}

/** Resolved from the installed delivery implementation, not written by hand. */
const DELIVERY_NOTE = deliveryNote(reportDelivery().mode);

/** The `reports` row, as `/api/scout/scans/{id}/report/generate` returns it. */
interface GeneratedReport {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly error: string | null;
  readonly pdfBytes: number | null;
  readonly pageCount: number | null;
  readonly link: { readonly url: string; readonly expiresOnLabel: string } | null;
}

interface ShareResponse {
  /** `null` under a delivery implementation that sends for itself. */
  readonly whatsappUrl: string | null;
  readonly mode: "handoff" | "sent";
  readonly deliveryNote: string;
  readonly link: { readonly url: string; readonly expiresOnLabel: string };
  readonly recipientName: string | null;
}

/**
 * Screen 04 — Report and share.
 *
 * ## Why the surveyor checklist lives here
 *
 * The mockup's screen 04 is a summary, a notes box and two share buttons. But
 * the fourteen practicals questions — road frontage, drainage, evening play
 * restrictions — are questions about the plot the surveyor is *standing on*,
 * and the moment they are cheapest to answer is right now, before the drive
 * home. Putting them on a desktop screen means they get filled in from memory
 * three days later, or not at all, and the score stays `desk_only` forever.
 *
 * The form is rendered from `GET /api/scout/scans/{id}/survey`, which serves Phase
 * 3's `SURVEYOR_CHECKLIST` verbatim. Nothing here restates a field, a label or
 * an anchor. A fifteenth field appears on this screen with no change to this
 * file.
 *
 * ## The basis flip is the point of the live score
 *
 * With no survey, component 5 is excluded and the remaining 85 points are
 * rescaled to 100 — a `desk_only` score, which is **not comparable** with a
 * surveyed one. Once four fields are answered the component comes in and the
 * basis becomes `full`. Showing that happen, live, is what makes it obvious
 * that finishing the checklist changes the *kind* of number, not just its
 * value.
 *
 * ## Generation is asynchronous, and the screen says so
 *
 * `Generate report` starts a background render and polls. The PDF is produced
 * by headless Chromium on the server, which takes seconds rather than
 * milliseconds, and a phone in the field is the worst possible place to hold a
 * request open for that long. The "Report ready" card is the success state, and
 * it carries the version, the size and the date the link stops working — a
 * salesperson standing in front of a customer should not have to guess any of
 * the three.
 */
export function ReportScreen({ scanId }: { scanId: string }) {
  const online = useOnline();

  const [result, setResult] = useState<ScanResult | null>(null);
  const [checklist, setChecklist] = useState<ChecklistPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [scoring, setScoring] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ------------------------------------------------- report generation */

  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [sharing, setSharing] = useState(false);
  const [sharedTo, setSharedTo] = useState<string | null>(null);

  const ready = report?.status === "generated" || report?.status === "delivered";

  /**
   * Generate, then poll.
   *
   * The POST answers 202 with a `generating` row and the render happens on the
   * server after the response. On a phone that matters more than anywhere
   * else: holding a request open for the length of a Chromium launch is how a
   * surveyor standing in a field with two bars gets a timeout instead of a
   * report.
   */
  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const started = await apiFetch<{ report: GeneratedReport }>(
        `/api/scout/scans/${scanId}/report/generate`,
        { method: "POST", timeoutMs: 40_000 },
      );
      setReport(started.data.report);

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const poll = await apiFetch<{ report: GeneratedReport | null }>(
          `/api/scout/scans/${scanId}/report/generate`,
        );
        const row = poll.data.report;
        if (!row) continue;
        setReport(row);
        if (row.status !== "generating") {
          if (row.status === "failed") setError(row.error);
          break;
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The report could not be produced.");
    } finally {
      setGenerating(false);
    }
  }, [scanId]);

  /**
   * Record the hand-over, then hand off to WhatsApp.
   *
   * `window.location.assign` rather than `window.open`: on iOS a popup opened
   * from an async callback is blocked as often as not, and a blocked popup here
   * looks like a broken button at the exact moment somebody is trying to send a
   * report to a customer.
   */
  const shareOnWhatsApp = useCallback(async () => {
    if (!report) return;
    setSharing(true);
    setError(null);
    try {
      const { data } = await apiFetch<ShareResponse>(`/api/scout/reports/${report.id}/share`, {
        method: "POST",
        body: { channel: "whatsapp", recipientName: recipient },
      });
      setSharedTo(data.recipientName);
      // Nothing to open under an implementation that sent it for itself.
      if (data.whatsappUrl) window.location.assign(data.whatsappUrl);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The share could not be recorded.");
    } finally {
      setSharing(false);
    }
  }, [report, recipient]);

  /* --------------------------------------------------------- initial load */

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [scan, survey] = await Promise.all([
          apiFetch<ScanResult>(`/api/scout/scans/${scanId}`),
          apiFetch<ChecklistPayload & { fieldNotes: string | null }>(`/api/scout/scans/${scanId}/survey`),
        ]);
        if (cancelled) return;
        setResult(scan.data);
        setChecklist(survey.data);
        setAnswers({ ...survey.data.answers });
        setNotes(survey.data.fieldNotes ?? "");
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load this scan.");
      }

      try {
        const { data } = await apiFetch<ScoreResponse>(`/api/scout/scans/${scanId}/score`);
        if (!cancelled) setScore(data.score);
      } catch {
        // No score yet is a normal state here; the strip says so.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  /* ------------------------------------------------- save, then rescore */

  const pending = useDebounced(JSON.stringify({ answers, notes }), 700);
  const lastSaved = useRef<string | null>(null);

  const save = useCallback(
    async (payload: string) => {
      const parsed = JSON.parse(payload) as { answers: Record<string, number>; notes: string };
      setSaveStatus("Saving…");
      setSaveError(false);
      try {
        const { data } = await apiFetch<{ rejected: string[]; rescoreRequired: boolean }>(
          `/api/scout/scans/${scanId}/survey`,
          {
            method: "PUT",
            body: { answers: parsed.answers, fieldNotes: parsed.notes },
            timeoutMs: 25_000,
          },
        );
        lastSaved.current = payload;

        if (data.rejected.length > 0) {
          setSaveStatus(`Saved, but these were not accepted: ${data.rejected.join(", ")}.`);
          setSaveError(true);
        } else {
          setSaveStatus("Saved.");
        }

        // The PUT's own `rescoreRequired` says the number is now out of date.
        if (data.rescoreRequired) {
          setScoring(true);
          try {
            const { data: scored } = await apiFetch<ScoreResponse>(`/api/scout/scans/${scanId}/score`, {
              method: "POST",
              timeoutMs: 40_000,
            });
            setScore(scored.score);
          } catch {
            setSaveStatus("Saved, but the score could not be recalculated yet.");
            setSaveError(true);
          } finally {
            setScoring(false);
          }
        }
      } catch (e) {
        setSaveStatus(
          e instanceof ApiError
            ? `Not saved — ${e.message} Nothing has been queued to send later.`
            : "Not saved. Nothing has been queued to send later.",
        );
        setSaveError(true);
      }
    },
    [scanId],
  );

  useEffect(() => {
    if (!checklist) return;
    if (lastSaved.current === null) {
      // Seed the baseline so the initial load does not trigger a write.
      lastSaved.current = pending;
      return;
    }
    if (lastSaved.current === pending) return;
    void save(pending);
  }, [pending, checklist, save]);

  /* ------------------------------------------------------------- render */

  const exact = result ? !result.saturation.anySaturated : true;
  const answeredCount = Object.keys(answers).length;

  return (
    <div className="mScreen">
      <FieldHeader
        statusLeft={online ? "Field mode" : "Offline"}
        statusRight={
          result ? `${result.areaLabel} · ${formatRadius(result.radiusM)}` : "Report"
        }
        backHref={`/scout/m/scan/${scanId}`}
        backLabel="Back to results"
        title="Report"
        activeKey="report"
        navContext={{ scanId }}
      />

      <div className="mScroll ss-scroll pt-5 pb-6 px-[var(--m-pad-x)] flex flex-col gap-[18px] mIn">
        {error ? (
          <p className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-12)] py-[13px] px-3.5 text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--m-muted-on-white)]" role="alert">
            {error}
          </p>
        ) : null}

        {/* ------------------------------------------- summary card */}
        {result ? (
          <section className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-16)] p-4 flex flex-col gap-2.5">
            <SectionLabel as="h1">In this report</SectionLabel>
            <p className="m-0 text-[length:var(--text-13)] text-[color:var(--m-muted-on-white)] leading-[1.7]">
              {`${formatCount(result.competitionCount, exact)} sports facilities · `}
              {`${formatCount(result.demandCount, exact)} demand places · `}
              {`${formatNumber(result.reviewTotal)} reviews`}
              <br />
              {result.nearestCompetitor
                ? `Nearest facility ${formatDistance(result.nearestCompetitor.distanceM)} · `
                : "No competitor found · "}
              {`avg rating ${formatRating(result.avgRating)}`}
            </p>
          </section>
        ) : null}

        {/* --------------------------------------------- live score */}
        {score ? (
          <section
            className={`flex items-center gap-3.5 bg-[var(--black)] text-[color:var(--on-dark)] rounded-[var(--radius-16)] py-3.5 px-4${scoring ? " opacity-60" : ""}`}
            aria-label="Site score"
            aria-busy={scoring}
          >
            <span className="font-display text-[28px] font-bold tracking-[0.02em] leading-none flex-none">{score.totalRounded}</span>
            <span className="min-w-0 text-[length:var(--text-11-5)] leading-normal text-[color:var(--on-dark-muted-strong)]">
              {`${score.verdict} · ${score.confidence.level} confidence · model v${score.modelVersion}`}
              {score.basis === "desk_only" ? (
                <span className="block text-[color:var(--sky)] mt-[3px]">{score.basisLabel}</span>
              ) : (
                <span className="block text-turf-100 mt-[3px]">
                  Full assessment — the site survey is included.
                </span>
              )}
            </span>
          </section>
        ) : null}

        {score?.hardFlags.map((flag) => (
          <p key={flag.code} className="bg-[var(--surface-card)] border border-track-500 rounded-[var(--radius-12)] py-[13px] px-3.5 text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--ink)]" role="alert">
            {flag.message}
          </p>
        ))}

        {/* --------------------------------------- surveyor checklist */}
        <div className="flex flex-col gap-[9px]">
          <SectionLabel as="h2">Site survey</SectionLabel>
          <p className="text-[length:var(--text-11-5)] text-[color:var(--m-muted)] leading-normal">
            {answeredCount === 0
              ? "Nothing recorded yet, so the score is a desk assessment. Four answers is enough to turn it into a full one."
              : answeredCount < 4
                ? `${4 - answeredCount} more answer${4 - answeredCount === 1 ? "" : "s"} and the score stops being a desk assessment.`
                : "The site survey is counted in the score."}
          </p>
          {checklist ? (
            <SurveyChecklist
              checklist={checklist}
              answers={answers}
              onChange={setAnswers}
              status={saveStatus}
              statusIsError={saveError}
              disabled={!online}
            />
          ) : (
            <p className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-12)] py-[13px] px-3.5 text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--m-muted-on-white)]">Loading the checklist…</p>
          )}
        </div>

        {/* ------------------------------------------- field notes */}
        <div className="flex flex-col gap-[9px]">
          <SectionLabel as="h2">Field notes</SectionLabel>
          <textarea
            className="w-full min-h-[130px] resize-y font-sans text-[length:var(--text-13-5)] leading-[1.6] text-[color:var(--ink)] bg-[var(--surface-card)] border border-[var(--border-strong)] rounded-lg p-3.5 outline-none focus-visible:border-[var(--accent)]"
            aria-label="Field notes"
            placeholder="What you saw that the data can't — parking, lighting, drainage, footfall at 7pm."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/*
         * Required on any document carrying a saturation figure, and the report
         * carries one. Placed where the person about to send it will read it.
         */}
        <p className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-12)] py-[13px] px-3.5 text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--m-muted-on-white)]">{POPULATION_LIMITATION_TEXT}</p>

        {ready && report?.link ? (
          <section className="bg-[var(--surface-card)] border border-turf-500 rounded-[var(--radius-16)] p-4 flex items-center gap-3 [animation:ssIn_0.22s_var(--ease-standard)] motion-reduce:[animation:none]">
            <span className="w-[34px] h-[34px] rounded-full bg-turf-100 flex items-center justify-center flex-none text-turf-500">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[length:var(--text-13-5)] font-semibold">
                Report ready — version {report.version}
              </span>
              <span className="block text-[length:var(--text-11-5)] text-[color:var(--m-muted-on-white)] mt-0.5 leading-normal">
                {report.pdfBytes ? `${(report.pdfBytes / 1024 / 1024).toFixed(2)} MB · ` : ""}
                {report.pageCount ? `${report.pageCount} pages · ` : ""}
                the link works until {report.link.expiresOnLabel}. Add who you are sending it to so
                the dashboard can show it.
                {sharedTo ? ` Logged as sent to ${sharedTo}.` : ""}
              </span>
            </span>
          </section>
        ) : null}

        {ready ? (
          <div className="flex flex-col gap-[9px]">
            <SectionLabel as="h2">Sending it to</SectionLabel>
            <input
              className="w-full min-h-[48px] font-sans text-[length:var(--text-13-5)] text-[color:var(--ink)] bg-[var(--surface-card)] border border-[var(--border-strong)] rounded-lg py-3 px-3.5 outline-none focus-visible:border-[var(--accent)]"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              aria-label="Who are you sending it to?"
              placeholder="e.g. Deepa"
            />
          </div>
        ) : null}

        {report?.status === "failed" ? (
          <p className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-12)] py-[13px] px-3.5 text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--m-muted-on-white)]">
            {report.error ??
              "The PDF could not be produced. Nothing has been sent to anyone — try again."}
          </p>
        ) : null}
      </div>

      <StickyFooter
        note={
          generating
            ? "Producing the PDF. You can keep working — it finishes in the background."
            : ready
              ? DELIVERY_NOTE
              : online
                ? undefined
                : "No network — the checklist and notes cannot be saved right now."
        }
      >
        {ready && report?.link ? (
          <>
            <button
              type="button"
              className="w-full flex items-center justify-center gap-2.5 bg-[var(--whatsapp)] text-[color:var(--black)] border-0 rounded-lg py-[17px] px-5 min-h-[var(--m-touch)] font-sans text-[length:var(--text-15-5)] font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              onClick={() => void shareOnWhatsApp()}
              disabled={sharing || !online}
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12.04 2C6.6 2 2.2 6.4 2.2 11.84c0 1.94.55 3.75 1.5 5.29L2 22l5-1.63a9.8 9.8 0 0 0 5.04 1.38h.01c5.43 0 9.84-4.4 9.84-9.84S17.47 2 12.04 2zm5.72 13.96c-.24.68-1.4 1.3-1.94 1.34-.5.04-.98.22-3.3-.69-2.78-1.1-4.55-3.93-4.69-4.11-.14-.19-1.12-1.49-1.12-2.84 0-1.35.71-2.02.96-2.29.25-.27.55-.34.73-.34h.53c.17 0 .4-.06.62.48.24.57.8 1.97.87 2.11.07.14.12.3.02.49-.1.19-.15.3-.29.47-.14.16-.3.36-.43.49-.14.14-.29.29-.13.57.17.27.74 1.22 1.58 1.97 1.09.97 2 1.27 2.28 1.41.28.14.44.12.6-.07.17-.19.7-.81.88-1.09.19-.27.37-.23.62-.14.25.09 1.6.75 1.87.89.27.14.46.2.53.31.07.12.07.66-.17 1.34z" />
              </svg>
              {sharing ? "Recording…" : "Share on WhatsApp"}
            </button>
            <Button
              variant="secondary"
              block
              onClick={() => window.location.assign(report.link!.url)}
            >
              Open the PDF
            </Button>
          </>
        ) : (
          <Button
            block
            size="lg"
            disabled={!result || !online || generating}
            onClick={() => void generate()}
          >
            {generating ? "Producing the report…" : "Generate report"}
          </Button>
        )}
      </StickyFooter>
    </div>
  );
}
