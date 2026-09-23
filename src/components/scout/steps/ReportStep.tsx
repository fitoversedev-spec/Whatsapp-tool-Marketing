"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import type { ReportBlockState, ReportBlockDef } from "@/lib/scout/reports/blocks";
import { REPORT_BLOCKS } from "@/lib/scout/reports/blocks";
import { deliveryNote, reportDelivery } from "@/lib/scout/reports/delivery";

export type ReportKind = "scan" | "analysis" | "combined";

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

interface ShareResponse {
  whatsappUrl: string | null;
  mode: "handoff" | "sent";
  deliveryNote: string;
  message: string;
  link: { url: string; expiresOnLabel: string };
  recipientName: string | null;
}

export interface ReportStepProps {
  scanId: string;
  analysisId: string | null;
  initialBlocks: ReportBlockState;
  initialBlockOrder: string[] | null;
  initialSectionText: Record<string, string> | null;
  initialNotes: string;
  suggestionsText: string;
  polishedSuggestions: string;
  preparedBy: string;
  initialReport: GeneratedReport | null;
  onBack: () => void;
}

const DELIVERY_NOTE = deliveryNote(reportDelivery().mode);
const GENERATE_POLL_MS = 2_000;
const GENERATE_POLL_LIMIT = 60;

function DragHandle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-300 flex-none cursor-grab active:cursor-grabbing">
      <circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/>
      <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
      <circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>
    </svg>
  );
}

const SECTION_PLACEHOLDERS: Record<string, string> = {
  "header": "Area name, radius, date collected, prepared by…",
  "stat-cards": "Facilities count, reviews total, average rating, demand places…",
  "score": "Site score verdict and component breakdown…",
  "saturation": "Facilities per weighted demand anchor, benchmark comparison…",
  "count-table": "Per-category counts, review totals, nearest example…",
  "sports-areas": "List of sports and fitness venues in the area…",
  "ai-summary": "AI-generated summary and sport recommendations…",
  "suggestions": "Your recommendations to the customer…",
  "map": "Map section notes…",
  "sweep": "Vacant plots and terraces notes…",
  "field-notes": "What the surveyor saw that the data cannot show…",
  "analysis-overview": "Market saturation, opportunity score, risks, recommendation…",
  "place-insights": "Per-place establishment dates, popular times, sentiment…",
  "limitations": "What this assessment does not cover…",
};

function EditIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={expanded ? "text-court-600" : "text-slate-400"}>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function SortableSection({
  block,
  isOn,
  onToggle,
  sectionText,
  onTextChange,
  loading,
}: {
  block: ReportBlockDef;
  isOn: boolean;
  onToggle: () => void;
  sectionText: string;
  onTextChange: (text: string) => void;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border px-3.5 py-3 transition-colors ${
        isDragging ? "border-court-400 bg-court-50 shadow-md" : isOn ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"
      }`}
    >
      <div className="flex items-center gap-2">
        {!block.alwaysOn && (
          <span {...attributes} {...listeners} className="flex-none touch-none">
            <DragHandle />
          </span>
        )}
        <label className="flex-1 flex items-center gap-2.5 cursor-pointer min-w-0">
          <input
            type="checkbox"
            checked={isOn}
            onChange={onToggle}
            disabled={block.alwaysOn}
            className="w-4 h-4 accent-court-500 flex-none"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">{block.label}</span>
            <span className="block text-xs text-slate-400 leading-snug">{block.help}</span>
          </span>
        </label>
        {block.alwaysOn ? (
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex-none">Always</span>
        ) : null}
        {isOn && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
            className={`p-1.5 rounded-md flex-none transition-colors ${expanded ? "bg-court-50 text-court-600" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"}`}
            title="Edit section content"
          >
            <EditIcon expanded={expanded} />
          </button>
        )}
      </div>
      {expanded && isOn && (
        <div className="mt-2 ml-6">
          {loading ? (
            <div className="text-xs text-slate-400 py-3">Loading section content…</div>
          ) : (
            <textarea
              className="w-full box-border min-h-[120px] resize-y font-mono text-[11.5px] leading-[1.65] text-slate-700 border border-slate-200 rounded-md p-2.5 outline-none focus:border-court-500 focus:ring-1 focus:ring-court-200 bg-white"
              value={sectionText}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder={SECTION_PLACEHOLDERS[block.id] ?? "Add or edit text for this section…"}
              onClick={(e) => e.stopPropagation()}
              rows={Math.max(4, sectionText.split("\n").length + 1)}
            />
          )}
        </div>
      )}
    </div>
  );
}

const REPORT_TYPE_OPTIONS: { value: ReportKind; label: string; description: string }[] = [
  { value: "scan", label: "Scan Report", description: "Area analysis with competition and demand data" },
  { value: "analysis", label: "AI Analysis Report", description: "AI-powered insights for each competitor" },
  { value: "combined", label: "Combined Report", description: "Complete scan + AI analysis in one document" },
];

export function ReportStep({
  scanId,
  analysisId,
  initialBlocks,
  initialBlockOrder,
  initialSectionText,
  initialNotes,
  suggestionsText,
  polishedSuggestions,
  preparedBy,
  initialReport,
  onBack,
}: ReportStepProps) {
  const [reportKind, setReportKind] = useState<ReportKind>(analysisId ? "combined" : "scan");
  const [blocks, setBlocks] = useState<ReportBlockState>(initialBlocks);
  const [blockOrder, setBlockOrder] = useState<string[]>(() => {
    if (initialBlockOrder && initialBlockOrder.length > 0) {
      const known = new Set(REPORT_BLOCKS.map((b) => b.id));
      const valid = initialBlockOrder.filter((id) => known.has(id));
      const missing = REPORT_BLOCKS.filter((b) => !valid.includes(b.id)).map((b) => b.id);
      return [...valid, ...missing];
    }
    return REPORT_BLOCKS.map((b) => b.id);
  });
  const [notes, setNotes] = useState(initialNotes);
  const [sectionText, setSectionText] = useState<Record<string, string>>(() => {
    if (initialSectionText && Object.keys(initialSectionText).length > 0) {
      return { ...initialSectionText };
    }
    const init: Record<string, string> = {};
    if (polishedSuggestions) init["suggestions"] = polishedSuggestions;
    else if (suggestionsText) init["suggestions"] = suggestionsText;
    if (initialNotes) init["field-notes"] = initialNotes;
    return init;
  });
  const [defaultSectionText, setDefaultSectionText] = useState<Record<string, string>>({});
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [reportName, setReportName] = useState(initialReport?.title ?? "");
  const [report, setReport] = useState<GeneratedReport | null>(initialReport);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showPreview, setShowPreview] = useState(
    !!(initialReport && (initialReport.status === "generated" || initialReport.status === "delivered")),
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scout/scans/${scanId}/report/section-text`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { sectionText?: Record<string, string> } | null) => {
        if (cancelled || !json?.sectionText) return;
        setDefaultSectionText(json.sectionText);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [scanId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleBlock = (blockId: string) => {
    setBlocks((prev) => ({ ...prev, [blockId]: !prev[blockId] }));
  };

  const updateSectionText = (blockId: string, text: string) => {
    setSectionText((prev) => ({ ...prev, [blockId]: text }));
    if (blockId === "field-notes") setNotes(text);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setBlockOrder((prev) => {
        const oldIdx = prev.indexOf(active.id as string);
        const newIdx = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  const orderedBlocks = blockOrder
    .map((id) => REPORT_BLOCKS.find((b) => b.id === id))
    .filter((b): b is ReportBlockDef => b != null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setShare(null);
    try {
      await fetch(`/api/scout/scans/${scanId}/report`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includedBlocks: blocks,
          blockOrder,
          sectionText,
          fieldNotes: sectionText["field-notes"] ?? notes,
          suggestionsText: sectionText["suggestions"] ?? suggestionsText,
          polishedSuggestions: sectionText["suggestions"] ?? polishedSuggestions,
          title: reportName.trim() || undefined,
        }),
      });

      const generateUrl =
        reportKind === "scan"
          ? `/api/scout/scans/${scanId}/report/generate`
          : `/api/scout/scans/${scanId}/report/generate?kind=${reportKind}&analysisId=${analysisId}`;

      const res = await fetch(generateUrl, { method: "POST" });
      const json = (await res.json()) as { report?: GeneratedReport; error?: string };
      if (!res.ok || !json.report) {
        setError(json.error ?? "The report could not be started.");
        setGenerating(false);
        return;
      }
      setReport(json.report);

      for (let attempt = 0; attempt < GENERATE_POLL_LIMIT; attempt++) {
        await new Promise((r) => setTimeout(r, GENERATE_POLL_MS));
        const poll = await fetch(`/api/scout/scans/${scanId}/report/generate`);
        if (!poll.ok) continue;
        const state = (await poll.json()) as { report?: GeneratedReport | null };
        if (!state.report) continue;
        setReport(state.report);
        if (state.report.status !== "generating") {
          if (state.report.status === "failed") setError(state.report.error);
          else setShowPreview(true);
          break;
        }
      }
    } catch {
      setError("The report request failed.");
    } finally {
      setGenerating(false);
    }
  }, [scanId, analysisId, reportKind, blocks, blockOrder, sectionText, notes, suggestionsText, polishedSuggestions, reportName]);

  const shareOnWhatsApp = useCallback(async () => {
    if (!report) return;
    setSharing(true);
    setError(null);
    try {
      const res = await fetch(`/api/scout/reports/${report.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "whatsapp" }),
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
      setError("The share could not be recorded.");
    } finally {
      setSharing(false);
    }
  }, [report]);

  const showAnalysisTypes = !!analysisId;
  const hasPreview = showPreview && report && (report.status === "generated" || report.status === "delivered");
  const outerClass = hasPreview
    ? "flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start"
    : "flex flex-col gap-5";

  return (
    <div className={outerClass}>
      <div className="flex flex-col gap-5">
        <div>
        <h2 className="m-0 text-base font-semibold">Generate Report</h2>
        <p className="m-0 mt-1 text-sm leading-[1.6] text-slate-500">
          Choose a report type, toggle sections, and generate a downloadable PDF.
        </p>
      </div>

      {error ? <StateBlock tone="error" title="Something failed" body={error} /> : null}

      {showAnalysisTypes ? (
        <div className="flex flex-col gap-2">
          <SectionLabel weight={700}>Report type</SectionLabel>
          <div className="flex flex-col gap-2">
            {REPORT_TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={[
                  "flex items-start gap-3 rounded-lg border px-3.5 py-3 cursor-pointer transition-colors",
                  reportKind === opt.value
                    ? "border-court-500 bg-court-50"
                    : "border-slate-200 hover:border-slate-300",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="reportKind"
                  value={opt.value}
                  checked={reportKind === opt.value}
                  onChange={() => setReportKind(opt.value)}
                  className="mt-0.5 accent-court-500"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-800">{opt.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionLabel weight={700}>Sections</SectionLabel>
          <span className="text-xs text-slate-400">Drag to reorder</span>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={blockOrder} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {orderedBlocks.map((block) => (
                <SortableSection
                  key={block.id}
                  block={block}
                  isOn={!!blocks[block.id]}
                  onToggle={() => toggleBlock(block.id)}
                  sectionText={sectionText[block.id] ?? defaultSectionText[block.id] ?? ""}
                  onTextChange={(text) => updateSectionText(block.id, text)}
                  loading={loadingPreview && !sectionText[block.id] && !defaultSectionText[block.id]}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel weight={700}>Report name</SectionLabel>
        <input
          className="w-full box-border font-sans text-sm text-slate-900 border border-slate-300 rounded-lg px-3.5 py-2.5 outline-none focus:border-court-500 focus:ring-2 focus:ring-court-500/20"
          value={reportName}
          onChange={(e) => setReportName(e.target.value)}
          placeholder={`${preparedBy} — Site Scout report`}
          aria-label="Report name"
        />
      </div>

      <Button block onClick={() => void generate()} disabled={generating}>
        {generating
          ? "Producing the report…"
          : report?.status === "generated" || report?.status === "delivered"
            ? "Generate a new version"
            : "Generate report"}
      </Button>

      {generating ? (
        <p className="m-0 text-[13px] leading-[1.6] text-slate-500" aria-live="polite">
          The PDF renders in the background. It usually takes a few seconds.
        </p>
      ) : null}

      {report && (report.status === "generated" || report.status === "delivered") && report.link ? (
        <div className="flex flex-col gap-[10px]">
          <p className="m-0 text-[13px] leading-[1.6] text-slate-500">
            Version {report.version} ready
            {report.pdfBytes ? ` · ${(report.pdfBytes / 1024 / 1024).toFixed(2)} MB` : ""}
            {report.pageCount ? ` · ${report.pageCount} pages` : ""}. The
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

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => window.open(`/api/scout/reports/${report.id}/pdf`, "_blank", "noopener,noreferrer")}>
              Open the PDF
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setShowPreview((p) => !p)}>
              {showPreview ? "Hide preview" : "Preview PDF"}
            </Button>
          </div>


          <div className="text-[13px] leading-[1.55] text-slate-700 bg-slate-50 rounded-md px-3 py-[10px] break-all [&_a]:text-court-600">
            <a href={report.link.url} target="_blank" rel="noreferrer">
              {report.link.url}
            </a>
          </div>

          <p className="m-0 text-[13px] leading-[1.65] text-slate-700 border border-dashed border-slate-300 rounded-md px-3 py-[10px]">
            {share?.deliveryNote ?? DELIVERY_NOTE} The link expires on{" "}
            {report.link.expiresOnLabel}; regenerating produces a new one.
          </p>

          {share ? (
            <p className="m-0 text-[13px] leading-[1.6] text-slate-500" aria-live="polite">
              Logged{share.recipientName ? ` as sent to ${share.recipientName}` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      {report?.status === "failed" ? (
        <StateBlock
          tone="error"
          eyebrow="Not generated"
          title="The PDF could not be produced"
          body={report.error ?? "The renderer failed. Nothing has been sent."}
          action={<Button variant="secondary" onClick={() => void generate()}>Try again</Button>}
        />
      ) : null}

      <div className="flex gap-3 mt-2">
        <Button variant="secondary" onClick={onBack}>Back</Button>
      </div>
      </div>

      {hasPreview && report ? (
        <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-100 lg:sticky lg:top-4 h-[480px] lg:h-[calc(100vh-8rem)]">
          <iframe
            src={`/api/scout/reports/${report.id}/pdf`}
            className="w-full h-full border-0"
            title="Report preview"
          />
        </div>
      ) : null}
    </div>
  );
}
