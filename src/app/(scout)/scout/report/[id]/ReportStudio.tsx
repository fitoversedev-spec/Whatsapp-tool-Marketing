"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { SiteMap, type SiteMapMarker } from "@/components/scout/map";
import { EditableReportTitle } from "@/components/scout/reports";
import {
  formatDistance,
  formatFullDate,
  formatRadius,
} from "@/lib/scout/display/format";
import { REPORT_BLOCKS, type ReportBlockState } from "@/lib/scout/reports/blocks";
import { deliveryNote, reportDelivery } from "@/lib/scout/reports/delivery";
import type { ScanScreenData } from "@/lib/scout/scans/dto";
import type { SweepDocument } from "@/lib/scout/sweep/grid";

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
  initialSuggestions: string;
  initialPolishedSuggestions: string;
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
  initialSuggestions,
  initialPolishedSuggestions,
  preparedBy,
  initialReport,
}: ReportStudioProps) {
  const [blocks, setBlocks] = useState<ReportBlockState>(initialBlocks);
  const [notes, setNotes] = useState(initialNotes);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const [suggestionsText, setSuggestionsText] = useState(initialSuggestions);
  const whatsappCaption = "";

  const [polishedSuggestions, setPolishedSuggestions] = useState(initialPolishedSuggestions);
  const [polishedText, setPolishedText] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);

  const [report, setReport] = useState<GeneratedReport | null>(initialReport);
  const [generating, setGenerating] = useState(false);
  const [reportName, setReportName] = useState(initialReport?.title ?? "");
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [sharing, setSharing] = useState(false);

  const suggestionsRef = useRef<HTMLTextAreaElement>(null);
  const polishedRef = useRef<HTMLTextAreaElement>(null);
  const acceptedRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = suggestionsRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [suggestionsText]);
  useEffect(() => {
    const el = polishedRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [polishedText]);
  useEffect(() => {
    const el = acceptedRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [polishedSuggestions]);

  const loadedDraft = useRef(JSON.stringify({ blocks: initialBlocks, notes: initialNotes, suggestionsText: initialSuggestions, polishedSuggestions: initialPolishedSuggestions }));
  useEffect(() => {
    if (JSON.stringify({ blocks, notes, suggestionsText, polishedSuggestions }) === loadedDraft.current) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/scout/scans/${scan.scanId}/report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ includedBlocks: blocks, fieldNotes: notes, suggestionsText, polishedSuggestions }),
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
  }, [blocks, notes, suggestionsText, polishedSuggestions, scan.scanId]);

  const polishWithAi = useCallback(async () => {
    if (!suggestionsText.trim()) return;
    setPolishing(true);
    setPolishError(null);
    try {
      const res = await fetch(`/api/scout/scans/${scan.scanId}/report/polish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: suggestionsText }),
      });
      const json = (await res.json()) as { polished?: string; error?: string };
      if (!res.ok || !json.polished) {
        setPolishError(json.error ?? "Polishing failed.");
        return;
      }
      setPolishedText(json.polished);
    } catch {
      setPolishError("Could not reach the server. Try again.");
    } finally {
      setPolishing(false);
    }
  }, [scan.scanId, suggestionsText]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setShare(null);
    try {
      if (reportName.trim()) {
        await fetch(`/api/scout/scans/${scan.scanId}/report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includedBlocks: blocks, fieldNotes: notes, suggestionsText, polishedSuggestions, title: reportName.trim() }),
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
  }, [scan.scanId, reportName, blocks, notes, suggestionsText, polishedSuggestions]);

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

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden ssIn">
      <aside className="w-full md:w-[420px] flex-none bg-white border-b md:border-b-0 md:border-r border-slate-200 overflow-y-auto px-6 pt-[26px] pb-8 flex flex-col gap-5 ss-scroll">
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

        {error ? <StateBlock tone="error" title="Something failed" body={error} /> : null}

        <div className="flex flex-col gap-[9px]">
          <SectionLabel weight={700}>Our suggestions</SectionLabel>
          <p className="m-0 text-[12.5px] leading-[1.6] text-slate-500">
            Write your rough thoughts — AI will polish them into a professional paragraph for the report.
          </p>
          <textarea
            ref={suggestionsRef}
            className="w-full box-border min-h-[110px] resize-none overflow-hidden font-sans text-[13.5px] leading-[1.65] text-slate-900 border border-slate-300 rounded-lg p-[14px] outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green"
            value={suggestionsText}
            onChange={(e) => { setSuggestionsText(e.target.value); setPolishedText(null); }}
            aria-label="Your raw suggestions for AI to polish"
            placeholder="e.g. good location for 5-a-side turf, only 2 competitors both indoor, lots of schools nearby, opportunity for outdoor facility with parking"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] text-slate-500" aria-live="polite">
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Draft saved"
                  : saveState === "error"
                    ? "The draft did not save."
                    : ""}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              disabled={polishing || !suggestionsText.trim()}
              onClick={() => void polishWithAi()}
            >
              {polishing ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Polishing…
                </>
              ) : polishedText ? "Regenerate with AI" : "Polish with AI"}
            </button>
          </div>
          {polishError ? (
            <p className="m-0 text-[12px] text-red-600">{polishError}</p>
          ) : null}
          {polishedText !== null ? (
            <div className="flex flex-col gap-[6px]">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">AI-polished preview</div>
              <textarea
                ref={polishedRef}
                className="w-full box-border min-h-[110px] resize-none overflow-hidden border-l-[3px] border-[#159341] bg-slate-50 rounded-r-lg px-4 py-3 text-[13px] leading-[1.7] text-slate-700 font-sans outline-none focus:ring-2 focus:ring-[#159341]"
                value={polishedText}
                onChange={(e) => setPolishedText(e.target.value)}
                aria-label="Edit AI-polished text"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[#159341] bg-[#159341] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#127a36] transition-colors"
                  onClick={() => { setPolishedSuggestions(polishedText ?? ""); setPolishedText(null); }}
                >
                  Use this version
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                  onClick={() => setPolishedText(null)}
                >
                  Discard
                </button>
              </div>
            </div>
          ) : null}
          {polishedSuggestions && polishedText === null ? (
            <div className="flex flex-col gap-[6px]">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold text-[#159341] uppercase tracking-wide">Accepted AI version (used in report)</div>
                <button
                  type="button"
                  className="text-[11px] text-red-500 hover:text-red-700 font-semibold transition-colors"
                  onClick={() => setPolishedSuggestions("")}
                >
                  Remove
                </button>
              </div>
              <textarea
                ref={acceptedRef}
                className="w-full box-border min-h-[80px] resize-none overflow-hidden border-l-[3px] border-[#159341] bg-[#f0fdf4] rounded-r-lg px-4 py-3 text-[13px] leading-[1.7] text-slate-700 font-sans outline-none focus:ring-2 focus:ring-[#159341]"
                value={polishedSuggestions}
                onChange={(e) => setPolishedSuggestions(e.target.value)}
                aria-label="Edit accepted AI-polished text"
              />
              <p className="m-0 text-[11px] text-slate-400">This version will appear in the report. Edit your raw text above and re-polish to generate a new version.</p>
            </div>
          ) : null}
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

            <Button variant="secondary" block onClick={() => window.open(`/api/scout/reports/${report.id}/pdf`, "_blank", "noopener,noreferrer")} data-guide="scout-report-download">
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

      <div className="flex-1 min-w-0 overflow-y-auto px-5 lg:px-10 pt-8 pb-12 bg-[#dedede] flex justify-center ss-scroll">
        <article className="w-full lg:w-[720px] bg-white shadow-[0_12px_34px_rgba(0,0,0,0.14)] px-[46px] py-[44px] flex flex-col gap-[26px] h-max" aria-label="Report preview" data-guide="scout-report-summary">
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

          {/* Section 1: Map */}
          <div>
            <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500 mb-2">Catchment map</div>
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
            {/* Map legend — simple color key */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
              {scan.categories
                .filter((c) => c.count > 0)
                .map((category) => {
                  const color = category.side === "competition" ? "#159341" : "#00aeef";
                  return (
                    <span key={category.categoryId} className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                      <span>{category.label} ({category.count})</span>
                    </span>
                  );
                })}
            </div>
          </div>

          {/* Section 2: Scan Results — grouped by category */}
          {scan.categories.filter((c) => c.side === "competition" && c.count > 0).length > 0 ? (
            <div>
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500 mb-3">Competition</div>
              {scan.categories
                .filter((c) => c.side === "competition" && c.count > 0)
                .map((category) => {
                  const members = scan.places
                    .filter((p) => p.side === "competition" && p.categories?.includes(category.categoryId))
                    .sort((a, b) => a.distanceM - b.distanceM);
                  return (
                  <div key={category.categoryId} className="mb-4">
                    <div className="flex justify-between items-baseline border-b border-slate-200 pb-1 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "#159341" }} />
                        <span className="font-semibold text-[13px]">{category.label}</span>
                        <span className="text-[10px] text-slate-400">(Nearest {category.label.toLowerCase()} from our plot)</span>
                      </div>
                      <span className="text-[11px] text-slate-500">{category.count} found</span>
                    </div>
                    <div className="flex flex-col">
                      {members.map((p) => (
                          <div key={p.placeId} className="flex justify-between py-[6px] text-[12.5px] border-b border-slate-100">
                            <span className="truncate mr-2">
                              {p.name}
                              {p.flooring ? <span className="text-[10px] text-slate-400 ml-1">· {p.flooring}{p.flooringDetail ? ` — ${p.flooringDetail}` : ""}</span> : null}
                            </span>
                            <span className="text-slate-500 whitespace-nowrap">{formatDistance(p.distanceM)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                  );
                })}
            </div>
          ) : null}

          {scan.categories.filter((c) => c.side === "demand" && c.count > 0).length > 0 ? (
            <div>
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500 mb-3">Nearby places</div>
              {scan.categories
                .filter((c) => c.side === "demand" && c.count > 0)
                .map((category) => (
                  <div key={category.categoryId} className="mb-4">
                    <div className="flex justify-between items-baseline border-b border-slate-200 pb-1 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "#00aeef" }} />
                        <span className="font-semibold text-[13px]">{category.label}</span>
                        <span className="text-[10px] text-slate-400">(Nearest {category.label.toLowerCase()} from our plot)</span>
                      </div>
                      <span className="text-[11px] text-slate-500">{category.count} found</span>
                    </div>
                    <div className="flex flex-col">
                      {scan.places
                        .filter((p) => p.side === "demand" && p.categories?.includes(category.categoryId))
                        .sort((a, b) => a.distanceM - b.distanceM)
                        .map((p) => (
                          <div key={p.placeId} className="flex justify-between py-[6px] text-[12.5px] border-b border-slate-100">
                            <span className="truncate mr-2">{p.name}</span>
                            <span className="text-slate-500 whitespace-nowrap">{formatDistance(p.distanceM)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
            </div>
          ) : null}

          {/* Section 3: Our Suggestions */}
          {suggestionsText || polishedSuggestions || polishedText ? (
            <div>
              <div className="text-[12px] font-bold tracking-[0.12em] uppercase text-slate-500">Our suggestions</div>
              <div className="mt-[10px] border-l-[3px] border-[#159341] bg-slate-50 rounded-r-lg px-4 py-3 text-[13px] leading-[1.7] text-slate-700 whitespace-pre-wrap">
                {polishedText ?? polishedSuggestions ?? suggestionsText}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {polishedText ? "Showing AI-polished preview" : polishedSuggestions ? "Showing accepted AI version" : "AI will polish this text when generating the report"}
              </p>
            </div>
          ) : null}

          <div className="border-t border-slate-200 pt-[14px] text-[11px] text-slate-500 leading-[1.6]">
            Prepared by {preparedBy} · Fitoverse · Data from public listings.
          </div>
        </article>
      </div>
    </div>
  );
}

export const REPORT_BLOCK_COUNT = REPORT_BLOCKS.length;
