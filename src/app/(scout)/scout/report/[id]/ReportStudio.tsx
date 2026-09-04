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
const DELIVERY_NOTE = deliveryNote(reportDelivery().mode);
const GENERATE_POLL_MS = 2_000;
const GENERATE_POLL_LIMIT = 60;

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

  const [report, setReport] = useState<GeneratedReport | null>(initialReport);
  const [generating, setGenerating] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [sharing, setSharing] = useState(false);

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
      if (rating === null) delete next[fieldId];
      else next[fieldId] = rating;
      return next;
    });
  }, []);

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
    <div className="flex-1 flex min-h-0 max-[900px]:flex-col ssIn">
      <aside className="w-[420px] flex-none bg-white border-r border-slate-200 overflow-y-auto px-6 pt-[26px] pb-8 flex flex-col gap-5 ss-scroll max-[900px]:w-full max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:border-slate-200">
        <div>
          <h1 className="m-0 text-base">Report studio</h1>
          <div className="text-[12.5px] text-slate-500 mt-[9px] font-sans tracking-normal normal-case">
            {scan.areaLabel} · {formatRadius(scan.radiusM)} · {formatFullDate(scan.scoredAt)}
          </div>
        </div>

        <SurveyorChecklist answers={answers} onChange={setAnswer} />
        <div className="text-[10.5px] text-slate-500" aria-live="polite">
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

        <div className="flex flex-col gap-[9px]">
          <SectionLabel weight={700}>Field notes</SectionLabel>
          <textarea
            className="w-full box-border min-h-[190px] resize-y font-sans text-[13.5px] leading-[1.65] text-slate-900 border border-slate-300 rounded-lg p-[14px] outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Field notes"
            placeholder="What you saw that the data can't — parking, lighting, drainage, footfall at 7pm."
          />
          <p className="m-0 text-[11px] leading-[1.65] text-slate-500">
            Colour for the report. The checklist above is what the score reads; this is what the
            customer reads.
          </p>
        </div>

        <div className="flex flex-col gap-[9px]">
          <SectionLabel weight={700}>Include</SectionLabel>
          {TOGGLEABLE_REPORT_BLOCKS.map((block) => (
            <label
              key={block.id}
              className={`flex items-start gap-[10px] text-[13px] px-[11px] py-[9px] border rounded-md cursor-pointer ${
                on(block.id) ? "border-wa-green" : "border-slate-200"
              }`}
            >
              <input
                type="checkbox"
                className="w-[15px] h-[15px] accent-wa-green mt-[2px] flex-none"
                checked={on(block.id)}
                onChange={(e) =>
                  setBlocks((prev) => ({ ...prev, [block.id]: e.target.checked }))
                }
              />
              <span className="flex flex-col gap-[3px]">
                <span>{block.label}</span>
                <span className="text-[10.5px] text-slate-500 leading-[1.55]">{block.help}</span>
              </span>
            </label>
          ))}
          <p className="m-0 text-[11px] leading-[1.65] text-slate-500">
            The area header and the limitations paragraph are always printed. The limitations
            paragraph is what stops a reader inferring a catchment population from a saturation
            figure, so it is not a composition choice.
          </p>
          <div className="text-[10.5px] text-slate-500" aria-live="polite">
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

        <a className="m-0 text-[11px] leading-[1.6] text-slate-500" href={`/api/scout/scans/${scan.scanId}/report/preview`} target="_blank" rel="noreferrer">
          Open the full preview in a new tab
        </a>

        {generating ? (
          <p className="m-0 text-[11px] leading-[1.6] text-slate-500" aria-live="polite">
            The PDF renders in the background, so you can keep working. It usually takes a few
            seconds; the first one after a deploy takes longer while the renderer starts.
          </p>
        ) : null}

        {report && (report.status === "generated" || report.status === "delivered") && report.link ? (
          <div className="flex flex-col gap-[10px]">
            <p className="m-0 text-[11px] leading-[1.6] text-slate-500">
              Version {report.version} ready
              {report.pdfBytes ? ` · ${(report.pdfBytes / 1024 / 1024).toFixed(2)} MB` : ""}
              {report.pageCount ? ` · ${report.pageCount} pages` : ""}
              {report.scoreModelVersion ? ` · score model v${report.scoreModelVersion}` : ""}. The
              link works until {report.link.expiresOnLabel}.
            </p>

            <input
              className="w-full box-border font-sans text-[13.5px] text-slate-900 border border-slate-300 rounded-md px-3 py-[10px] outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              aria-label="Who are you sending it to?"
              placeholder="Who are you sending it to? (e.g. Deepa)"
            />

            <button
              type="button"
              className="w-full flex items-center justify-center gap-[10px] bg-[#25D366] text-slate-900 border-0 rounded-lg px-[18px] py-[14px] font-sans text-[14.5px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

            <div className="text-[11px] leading-[1.55] text-slate-700 bg-slate-50 rounded-md px-3 py-[10px] break-all [&_a]:text-court-600">
              <a href={report.link.url} target="_blank" rel="noreferrer">
                {report.link.url}
              </a>
            </div>

            <p className="m-0 text-[11px] leading-[1.65] text-slate-700 border border-dashed border-slate-300 rounded-md px-3 py-[10px]">
              {share?.deliveryNote ?? DELIVERY_NOTE} The link expires on{" "}
              {report.link.expiresOnLabel}; regenerating produces a new one and leaves this version
              readable until then.
            </p>

            {share ? (
              <p className="m-0 text-[11px] leading-[1.6] text-slate-500" aria-live="polite">
                Logged{share.recipientName ? ` as sent to ${share.recipientName}` : ""}. This scan
                now shows as "Report sent" on the dashboard.
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

      <div className="flex-1 min-w-0 overflow-y-auto px-10 pt-8 pb-12 bg-[#dedede] flex justify-center ss-scroll max-[1200px]:px-5">
        <article className="w-[720px] bg-white shadow-[0_12px_34px_rgba(0,0,0,0.14)] px-[46px] py-[44px] flex flex-col gap-[26px] h-max max-[1200px]:w-full" aria-label="Report preview">
          <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4">
            <div className="flex items-center gap-[11px]">
              <svg className="w-7 h-7 flex-none" viewBox="0 0 28 28" aria-hidden="true">
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
              <span className="font-display uppercase tracking-[0.12em] text-[13px] font-bold">Site Scout report</span>
            </div>
            <span className="text-[11.5px] text-slate-500">{formatFullDate(new Date())}</span>
          </div>

          <div>
            <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-slate-500">Area</div>
            <div className="text-2xl font-semibold mt-2">
              {scan.areaLabel} — {formatRadius(scan.radiusM)} radius
            </div>
          </div>

          {score ? (
            <div>
              <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-slate-500">Verdict</div>
              <div style={{ marginTop: 8 }}>
                <Badge tone={verdictTone(score.verdict)}>
                  {verdictLabel(score.verdict)} · {score.totalRounded}/100
                </Badge>
              </div>
            </div>
          ) : null}

          {on("stat-cards") ? (
            <div className="grid grid-cols-4 gap-[14px]">
              <div className="border border-slate-200 rounded-lg p-[14px]">
                <div className="font-display text-[22px] font-bold">
                  {atLeast(scan.competitionCount, scan.anySaturated)}
                </div>
                <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[6px]">Facilities</div>
              </div>
              <div className="border border-slate-200 rounded-lg p-[14px]">
                <div className="font-display text-[22px] font-bold">{formatCount(scan.reviewTotal)}</div>
                <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[6px]">Reviews</div>
              </div>
              <div className="border border-slate-200 rounded-lg p-[14px]">
                <div className="font-display text-[22px] font-bold">{formatRating(scan.avgRating)}</div>
                <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[6px]">Avg rating</div>
              </div>
              <div className="bg-slate-900 text-white rounded-lg p-[14px]">
                <div className="font-display text-[22px] font-bold">
                  {atLeast(scan.demandCount, scan.anySaturated)}
                </div>
                <div className="text-[10px] tracking-[0.09em] uppercase text-white/40 mt-[6px]">Demand places</div>
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
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1.4fr_0.6fr_0.8fr_0.8fr] px-[15px] py-[11px] bg-slate-100 text-[9.5px] font-bold tracking-[0.09em] uppercase text-slate-500">
                <span>Category</span>
                <span className="text-right">Count</span>
                <span className="text-right">Reviews</span>
                <span className="text-right">Nearest</span>
              </div>
              {scan.categories.map((c) => (
                <div key={c.categoryId} className="grid grid-cols-[1.4fr_0.6fr_0.8fr_0.8fr] px-[15px] py-[11px] text-[12.5px] border-t border-slate-200 [&>span:first-child]:font-semibold">
                  <span>{c.label}</span>
                  <span className="text-right">{atLeast(c.count, c.saturated)}</span>
                  <span className="text-right text-slate-500">
                    {c.reviewTotal > 0 ? formatCount(c.reviewTotal) : "—"}
                  </span>
                  <span className="text-right text-slate-500">
                    {c.nearestM === null ? "—" : formatDistance(c.nearestM)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {on("map") ? (
            <div className="h-[260px] rounded-lg overflow-hidden border border-slate-200 relative">
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
              <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-slate-500">Spaces sweep</div>
              {sweepMarked.length === 0 ? (
                <p className="text-[13.5px] leading-[1.75] text-slate-700 mt-[10px] whitespace-pre-wrap min-h-[60px]">
                  No cells were marked in the sweep of this area.
                </p>
              ) : (
                <div className="flex flex-col gap-[7px] text-[12.5px] leading-[1.65] text-slate-700 mt-[10px]">
                  {sweepMarked.map((cell) => (
                    <div key={cell.id}>
                      <strong>
                        {cell.id} · {sweepStatusLabel(cell.status)}
                      </strong>
                      {cell.note ? ` — ${cell.note}` : ""}
                    </div>
                  ))}
                  <p className="text-[11.5px] leading-[1.7] text-slate-500 mt-[10px]">
                    Marked from satellite imagery only. Imagery is typically one to three years old.
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {on("field-notes") ? (
            <div>
              <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-slate-500">Field notes</div>
              <div className="text-[13.5px] leading-[1.75] text-slate-700 mt-[10px] whitespace-pre-wrap min-h-[60px]">
                {notes || "Field notes appear here as you type them."}
              </div>
            </div>
          ) : null}

          <div>
            <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-slate-500">{limitations.heading}</div>
            {limitations.paragraphs.map((p) => (
              <p key={p} className="text-[11.5px] leading-[1.7] text-slate-500 mt-[10px]">
                {p}
              </p>
            ))}
            {!limitations.paragraphs.includes(POPULATION_LIMITATION_TEXT) ? (
              <p className="text-[11.5px] leading-[1.7] text-slate-500 mt-[10px]">{POPULATION_LIMITATION_TEXT}</p>
            ) : null}
          </div>

          <div className="border-t border-slate-200 pt-[14px] text-[11px] text-slate-500 leading-[1.6]">
            Prepared by {preparedBy} · Fitoverse · Data from public listings
            {score ? ` · scored under model v${score.modelVersion}` : ""}
            {scan.anySaturated
              ? ` · counts marked "at least" are floors: a search returned the maximum results a single query can`
              : ""}
            . This report contains no projection of revenue or return.
          </div>
        </article>
      </div>
    </div>
  );
}

export const REPORT_BLOCK_COUNT = REPORT_BLOCKS.length;
