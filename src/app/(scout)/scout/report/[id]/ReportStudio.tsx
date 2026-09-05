"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { SiteMap, type SiteMapMarker } from "@/components/scout/map";
import { SaturationPanel, ScorePanel } from "@/components/scout/score";
import { EditableReportTitle } from "@/components/scout/reports";
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
import { REPORT_BLOCKS, type ReportBlockState } from "@/lib/scout/reports/blocks";
import { deliveryNote, reportDelivery } from "@/lib/scout/reports/delivery";
import type { ScanScreenData } from "@/lib/scout/scans/dto";
import type { ScoreResult } from "@/lib/scout/scoring/types";
import { markedCells, sweepStatusLabel, type SweepDocument } from "@/lib/scout/sweep/grid";

export interface GeneratedReport {
  id: string;
  version: number;
  status: string;
  title: string | null;
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
  const [score, setScore] = useState<ScoreResult | null>(scan.score);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const [suggestionsText, setSuggestionsText] = useState("");
  const whatsappCaption = "";

  const [report, setReport] = useState<GeneratedReport | null>(initialReport);
  const [generating, setGenerating] = useState(false);
  const [reportName, setReportName] = useState(initialReport?.title ?? "");
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [sharing, setSharing] = useState(false);

  const loadedDraft = useRef(JSON.stringify({ blocks: initialBlocks, notes: initialNotes }));
  useEffect(() => {
    if (JSON.stringify({ blocks, notes, suggestionsText }) === loadedDraft.current) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/scout/scans/${scan.scanId}/report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ includedBlocks: blocks, fieldNotes: notes, suggestionsText }),
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
  }, [blocks, notes, suggestionsText, scan.scanId]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setShare(null);
    try {
      if (reportName.trim()) {
        await fetch(`/api/scout/scans/${scan.scanId}/report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includedBlocks: blocks, fieldNotes: notes, suggestionsText, title: reportName.trim() }),
        });
      }
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
  }, [scan.scanId, reportName, blocks, notes, suggestionsText]);

  const shareOnWhatsApp = useCallback(async () => {
    if (!report) return;
    setSharing(true);
    setError(null);
    try {
      const res = await fetch(`/api/scout/reports/${report.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "whatsapp", caption: whatsappCaption || undefined }),
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
  }, [report, whatsappCaption]);

  const on = useCallback((id: string) => blocks[id] === true, [blocks]);

  const markers = useMemo<SiteMapMarker[]>(
    () =>
      scan.places.slice(0, 120).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        type: p.side === "competition" ? "facility" : "demand",
        placeId: p.placeId,
        name: p.name,
        rating: p.rating,
        reviewCount: p.reviewCount,
        distanceM: p.distanceM,
        primaryTypeDisplayName: p.primaryTypeDisplayName,
        googleMapsUri: p.googleMapsUri,
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
          {report && (report.status === "generated" || report.status === "delivered") ? (
            <div className="mt-3">
              <EditableReportTitle
                reportId={report.id}
                title={report.title ?? ""}
                placeholder={`${scan.areaLabel} — Site Scout report`}
                onSaved={(title) => setReport((prev) => (prev ? { ...prev, title } : prev))}
                className="group flex items-center gap-1.5 min-w-0 max-w-full text-left bg-transparent border-0 p-0 cursor-text font-sans text-[13px] font-semibold text-slate-800 hover:text-slate-900"
                inputClassName="w-full box-border font-sans text-[13px] font-semibold text-slate-900 border border-slate-300 rounded-md px-2.5 py-1.5 outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green"
              />
            </div>
          ) : null}
        </div>

        {/* AI Analysis — based on scan data */}
        <div className="flex flex-col gap-3">
          <SectionLabel weight={700}>AI analysis</SectionLabel>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex flex-col gap-2.5">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-court-600 mt-0.5 flex-none" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
              <p className="m-0 text-xs leading-[1.6] text-slate-700">
                The report will be generated with AI analysis covering: <strong>best sport for this area</strong>, <strong>revenue potential</strong>, <strong>existing competition</strong>, and <strong>area suitability</strong> — all based on the scan data.
              </p>
            </div>
            {scan.competitionCount > 0 || scan.demandCount > 0 ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-white border border-slate-200 px-3 py-2">
                  <div className="text-slate-500 text-[12px]">Facilities found</div>
                  <div className="font-semibold text-slate-900">{atLeast(scan.competitionCount ?? 0, scan.anySaturated)}</div>
                </div>
                <div className="rounded bg-white border border-slate-200 px-3 py-2">
                  <div className="text-slate-500 text-[12px]">Demand anchors</div>
                  <div className="font-semibold text-slate-900">{atLeast(scan.demandCount ?? 0, scan.anySaturated)}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {error ? <StateBlock tone="error" title="Something failed" body={error} /> : null}

        <div className="flex flex-col gap-[9px]">
          <SectionLabel weight={700}>Custom notes</SectionLabel>
          <textarea
            className="w-full box-border min-h-[140px] resize-y font-sans text-[13.5px] leading-[1.65] text-slate-900 border border-slate-300 rounded-lg p-[14px] outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Custom notes for the report"
            placeholder="Add any custom points you want included in the report — e.g. nearby upcoming developments, land cost observations, footfall patterns at 7pm, lighting and parking notes."
          />
          <p className="m-0 text-[13px] leading-[1.65] text-slate-500">
            These notes will be included in the AI-generated report alongside the scan data analysis.
          </p>
          <div className="text-[12px] text-slate-500" aria-live="polite">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Draft saved"
                : saveState === "error"
                  ? "The draft did not save."
                  : ""}
          </div>
        </div>

        <div className="flex flex-col gap-[9px]">
          <SectionLabel weight={700}>Our suggestions</SectionLabel>
          <textarea
            className="w-full box-border min-h-[120px] resize-y font-sans text-[13.5px] leading-[1.65] text-slate-900 border border-slate-300 rounded-lg p-[14px] outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green"
            value={suggestionsText}
            onChange={(e) => setSuggestionsText(e.target.value)}
            aria-label="Your custom suggestions for the customer"
            placeholder="Write your suggestions for the customer — e.g. recommended sports, facility layout ideas, pricing strategy, unique selling points for this location."
          />
          <p className="m-0 text-[13px] leading-[1.65] text-slate-500">
            This section appears in the report as "Our Suggestions" — your custom recommendations to the customer.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel weight={700}>Report name</SectionLabel>
          <input
            className="w-full box-border font-sans text-sm text-slate-900 border border-slate-300 rounded-lg px-3.5 py-2.5 outline-none focus:border-court-500 focus:ring-2 focus:ring-court-500/20"
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            aria-label="Report name"
            placeholder={`${scan.areaLabel} — Site Scout report`}
          />
        </div>

        <Button block onClick={() => void generate()} disabled={generating}>
          {generating
            ? "Producing the report…"
            : report?.status === "generated" || report?.status === "delivered"
              ? "Generate a new version"
              : "Generate report"}
        </Button>

        <a className="m-0 text-[13px] leading-[1.6] text-slate-500" href={`/api/scout/scans/${scan.scanId}/report/preview`} target="_blank" rel="noreferrer">
          Open the full preview in a new tab
        </a>

        {generating ? (
          <p className="m-0 text-[13px] leading-[1.6] text-slate-500" aria-live="polite">
            The PDF renders in the background, so you can keep working. It usually takes a few
            seconds; the first one after a deploy takes longer while the renderer starts.
          </p>
        ) : null}

        {report && (report.status === "generated" || report.status === "delivered") && report.link ? (
          <div className="flex flex-col gap-[10px]">
            <p className="m-0 text-[13px] leading-[1.6] text-slate-500">
              Version {report.version} ready
              {report.pdfBytes ? ` · ${(report.pdfBytes / 1024 / 1024).toFixed(2)} MB` : ""}
              {report.pageCount ? ` · ${report.pageCount} pages` : ""}
              {report.scoreModelVersion ? ` · score model v${report.scoreModelVersion}` : ""}. The
              link works until {report.link.expiresOnLabel}.
            </p>

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

            <div className="text-[13px] leading-[1.55] text-slate-700 bg-slate-50 rounded-md px-3 py-[10px] break-all [&_a]:text-court-600">
              <a href={report.link.url} target="_blank" rel="noreferrer">
                {report.link.url}
              </a>
            </div>

            <p className="m-0 text-[13px] leading-[1.65] text-slate-700 border border-dashed border-slate-300 rounded-md px-3 py-[10px]">
              {share?.deliveryNote ?? DELIVERY_NOTE} The link expires on{" "}
              {report.link.expiresOnLabel}; regenerating produces a new one and leaves this version
              readable until then.
            </p>

            {share ? (
              <p className="m-0 text-[13px] leading-[1.6] text-slate-500" aria-live="polite">
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
                    <stop offset="45%" stopColor="#4DC6F4" />
                    <stop offset="80%" stopColor="var(--navy)" />
                    <stop offset="100%" stopColor="var(--red)" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width="28" height="28" rx="7" fill="url(#ss-report-mark)" />
              </svg>
              <span className="font-heading uppercase tracking-[0.12em] text-[13px] font-bold">Site Scout report</span>
            </div>
            <span className="text-[11.5px] text-slate-500">{formatFullDate(new Date())}</span>
          </div>

          <div>
            <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">Area</div>
            <div className="text-2xl font-semibold mt-2">
              {scan.areaLabel} — {formatRadius(scan.radiusM)} radius
            </div>
          </div>

          {score ? (
            <div>
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">Verdict</div>
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
                <div className="font-heading text-[22px] font-bold">
                  {atLeast(scan.competitionCount, scan.anySaturated)}
                </div>
                <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[6px]">Facilities</div>
              </div>
              <div className="border border-slate-200 rounded-lg p-[14px]">
                <div className="font-heading text-[22px] font-bold">{formatCount(scan.reviewTotal)}</div>
                <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[6px]">Reviews</div>
              </div>
              <div className="border border-slate-200 rounded-lg p-[14px]">
                <div className="font-heading text-[22px] font-bold">{formatRating(scan.avgRating)}</div>
                <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[6px]">Avg rating</div>
              </div>
              <div className="bg-slate-900 text-white rounded-lg p-[14px]">
                <div className="font-heading text-[22px] font-bold">
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

          {on("sports-areas") && scan.places.filter((p) => p.side === "competition").length > 0 ? (
            <div>
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">Available sports facilities</div>
              <div className="border border-slate-200 rounded-lg overflow-hidden mt-[10px]">
                <div className="grid grid-cols-[1.4fr_0.6fr_0.6fr] px-[15px] py-[11px] bg-slate-100 text-[9.5px] font-bold tracking-[0.09em] uppercase text-slate-500">
                  <span>Facility</span>
                  <span className="text-right">Distance</span>
                  <span className="text-right">Rating</span>
                </div>
                {scan.places
                  .filter((p) => p.side === "competition")
                  .sort((a, b) => a.distanceM - b.distanceM)
                  .slice(0, 15)
                  .map((p) => (
                    <div key={p.placeId} className="grid grid-cols-[1.4fr_0.6fr_0.6fr] px-[15px] py-[11px] text-[12.5px] border-t border-slate-200">
                      <span className="font-semibold truncate">{p.name}</span>
                      <span className="text-right text-slate-500">{formatDistance(p.distanceM)}</span>
                      <span className="text-right text-slate-500">{formatRating(p.rating)} ★</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}

          {on("ai-summary") ? (
            <div>
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">AI analysis</div>
              <div className="mt-[10px] border-l-[3px] border-[#2e3192] bg-slate-50 rounded-r-lg px-4 py-3 text-[13px] leading-[1.7] text-slate-700">
                AI analysis will be generated based on scan data — recommending the best sports for this location, revenue potential, and competitive positioning.
              </div>
            </div>
          ) : null}

          {on("suggestions") && suggestionsText ? (
            <div>
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">Our suggestions</div>
              <div className="mt-[10px] border-l-[3px] border-[#159341] bg-slate-50 rounded-r-lg px-4 py-3 text-[13px] leading-[1.7] text-slate-700 whitespace-pre-wrap">
                {suggestionsText}
              </div>
            </div>
          ) : null}

          {on("map") ? (
            <div className="h-[260px] rounded-lg overflow-hidden border border-slate-200 relative">
              <SiteMap
                lat={scan.centre.lat}
                lng={scan.centre.lng}
                radius={scan.radiusM / 1000}
                markers={markers}
                popups
                interactive
                ariaLabel={`Catchment map for ${scan.areaLabel}`}
              />
            </div>
          ) : null}

          {on("sweep") ? (
            <div>
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">Spaces sweep</div>
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
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">Field notes</div>
              <div className="text-[13.5px] leading-[1.75] text-slate-700 mt-[10px] whitespace-pre-wrap min-h-[60px]">
                {notes || "Field notes appear here as you type them."}
              </div>
            </div>
          ) : null}

          <div>
            <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">{limitations.heading}</div>
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
