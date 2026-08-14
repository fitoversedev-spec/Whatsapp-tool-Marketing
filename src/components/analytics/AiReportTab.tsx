"use client";

// Feature 2 — AI analytics reports (admin-only, read-only, internal-assist).
// A freeform question goes to POST /api/crm/analytics/ai-report; the model
// answers ONLY by calling the real analytics tools server-side, so every
// number rendered here comes back from a tool call — this component never
// computes or invents figures, it just displays the narrative + dataBlocks the
// route returns. Nothing here sends anything to a customer.
import { useState } from "react";
import Markdown from "@/components/Markdown";
import { useToast } from "@/components/Toast";

// Mirrors the route contract's PeriodInput preset arm. The { from, to } custom
// arm exists in the contract but this panel intentionally exposes only the
// named presets via a simple <select>, per the spec.
type PeriodPreset =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_fy"
  | "all_time";

const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "this_fy", label: "This financial year" },
  { value: "all_time", label: "All time" },
];

// Quick-pick chips just fill the question box — they don't submit. The label
// doubles as the question text so what the user sees is exactly what's asked.
const QUICK_PICKS = [
  "Best sellers this month",
  "Rep performance this quarter",
  "Revenue vs target",
  "Pipeline health",
  "Open deals by rep",
];

// Route response shape (fixed contract). `rows: any` because each analytics
// tool returns its own shape — the flexible table below normalizes whatever
// comes back without assuming a schema.
type DataBlock = { tool: string; title: string; rows: unknown };
type AiReportResponse = { narrative: string; dataBlocks: DataBlock[] };

type AskedBody = { question: string; period: PeriodPreset };

// A share target from GET /api/chat/threads — the Team channel plus a DM row per
// teammate. We post the report narrative into the chosen one via the existing
// chat messages API (no new endpoint).
type ShareThread = {
  threadId: string;
  entityType: "account_contact" | "deal" | "team" | "dm";
  entityId: string;
  label: string;
  sublabel: string;
};

// Team-chat message bodies are capped at 4000 chars (postSchema). Leave a little
// headroom for the header line we prepend.
const MAX_CHAT_BODY = 4000;

function messageForStatus(status: number): string {
  if (status === 402) return "The AI credit has run out — please top up your Anthropic balance to keep using AI.";
  if (status === 401 || status === 403) return "You need to be signed in to use this.";
  if (status === 429) return "You've hit the daily AI limit (or it's rate-limited) — try again shortly.";
  if (status === 503) return "The AI service is temporarily unavailable. Please try again shortly.";
  if (status === 500) return "Something went wrong generating the report. Please try again.";
  return `Request failed (${status}). Please try again.`;
}

// camelCase / snake_case tool keys → readable column headers.
function humanizeKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Normalizes the tool's `rows` into headers + a 2D string grid, handling the
// shapes a tool might realistically return: array of objects, array of arrays,
// array of primitives, a single object (key/value), or a bare scalar.
function normalizeRows(rows: unknown): { headers: string[]; body: string[][] } {
  if (rows == null) return { headers: [], body: [] };

  if (Array.isArray(rows)) {
    if (rows.length === 0) return { headers: [], body: [] };
    const first = rows[0];
    if (Array.isArray(first)) {
      return { headers: [], body: (rows as unknown[][]).map((r) => r.map(fmtCell)) };
    }
    if (first !== null && typeof first === "object") {
      const headers: string[] = [];
      for (const r of rows as Record<string, unknown>[]) {
        for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
      }
      const body = (rows as Record<string, unknown>[]).map((r) => headers.map((h) => fmtCell(r[h])));
      return { headers: headers.map(humanizeKey), body };
    }
    return { headers: [], body: (rows as unknown[]).map((v) => [fmtCell(v)]) };
  }

  if (typeof rows === "object") {
    return {
      headers: ["Field", "Value"],
      body: Object.entries(rows as Record<string, unknown>).map(([k, v]) => [humanizeKey(k), fmtCell(v)]),
    };
  }

  return { headers: [], body: [[fmtCell(rows)]] };
}

// Titled table for one dataBlock — styling mirrors the shared DataTable, but
// kept inline (and header-optional) so it renders cleanly whatever shape the
// tool returned.
function DataBlockCard({ block }: { block: DataBlock }) {
  const { headers, body } = normalizeRows(block.rows);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-base font-semibold text-slate-900">{block.title}</h3>
      <div className="mt-3 overflow-x-auto">
        {body.length === 0 ? (
          <p className="text-sm text-slate-400">No data for this section.</p>
        ) : (
          <table className="w-full text-sm">
            {headers.length > 0 && (
              <thead>
                <tr className="text-left border-b border-slate-200">
                  {headers.map((h, i) => (
                    <th key={i} className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-2 py-2 whitespace-nowrap ${j === 0 ? "font-medium text-slate-900" : "text-slate-700"}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function AiReportTab() {
  const toast = useToast();
  const [question, setQuestion] = useState("");
  const [period, setPeriod] = useState<PeriodPreset>("this_month");
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiReportResponse | null>(null);
  // The exact body that produced the currently-shown result — the PDF export
  // reuses this so the downloaded report always matches what's on screen, even
  // if the user has since edited the textarea.
  const [asked, setAsked] = useState<AskedBody | null>(null);

  // "Share to chat" — a lazy-loaded teammate/thread picker that posts the
  // report's narrative into a team-chat DM (or the Team channel).
  const [shareOpen, setShareOpen] = useState(false);
  const [shareThreads, setShareThreads] = useState<ShareThread[] | null>(null);
  const [shareQuery, setShareQuery] = useState("");
  const [sharingId, setSharingId] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q) {
      setError("Type a question first.");
      return;
    }
    const body: AskedBody = { question: q, period };
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/crm/analytics/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(messageForStatus(res.status));
        return;
      }
      const data = (await res.json()) as AiReportResponse;
      setResult(data);
      setAsked(body);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    if (!asked) return;
    setPdfLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/analytics/ai-report?format=pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(asked),
      });
      if (!res.ok) {
        setError(messageForStatus(res.status));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ai-sales-report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't download the PDF. Please try again.");
    } finally {
      setPdfLoading(false);
    }
  }

  // Toggle the picker; lazy-load the share targets (Team channel + teammate DMs)
  // the first time it's opened.
  async function toggleShare() {
    const next = !shareOpen;
    setShareOpen(next);
    if (next && shareThreads === null) {
      try {
        const res = await fetch("/api/chat/threads");
        const data = res.ok ? await res.json() : { threads: [] };
        setShareThreads((data.threads ?? []) as ShareThread[]);
      } catch {
        setShareThreads([]);
      }
    }
  }

  // The narrative, prefixed with a one-line header, clamped to the chat body
  // limit. Markdown is posted as-is — chat renders it as plain text.
  function buildShareText(): string {
    const q = asked?.question.trim();
    const periodLabel = PERIOD_PRESETS.find((p) => p.value === asked?.period)?.label;
    const header = q
      ? `✨ AI report — ${q}${periodLabel ? ` (${periodLabel})` : ""}`
      : "✨ AI report";
    const text = `${header}\n\n${result?.narrative.trim() ?? ""}`;
    return text.length > MAX_CHAT_BODY ? `${text.slice(0, MAX_CHAT_BODY - 1)}…` : text;
  }

  async function shareTo(t: ShareThread) {
    if (!result || sharingId) return;
    setSharingId(t.entityId);
    try {
      const res = await fetch(`/api/chat/threads/${t.entityType}/${t.entityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: buildShareText() }),
      });
      if (!res.ok) {
        toast.error("Couldn't share the report. Please try again.");
        return;
      }
      toast.success(`Report shared to ${t.label}`);
      setShareOpen(false);
      setShareQuery("");
    } catch {
      toast.error("Couldn't reach the server. Please try again.");
    } finally {
      setSharingId(null);
    }
  }

  const hasNarrative = !!result && result.narrative.trim().length > 0;
  const filteredShareThreads = (shareThreads ?? []).filter((t) =>
    t.label.toLowerCase().includes(shareQuery.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-base font-semibold text-slate-900">Ask AI about your sales data</h3>
        <p className="text-sm text-slate-600 mt-1 mb-3">
          Ask in plain English. The assistant answers only from your real CRM analytics — every figure comes from the
          underlying reports, never made up.
        </p>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about your sales data…"
          rows={3}
          className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:border-wa-green focus:outline-none focus:ring-2 focus:ring-wa-green/20"
        />

        <div className="flex flex-wrap gap-1.5 mt-3">
          {QUICK_PICKS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuestion(q)}
              className="bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-medium px-3 py-1 rounded-full"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <label className="text-xs font-medium text-slate-500">Period</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodPreset)}
            className="border border-slate-300 rounded-xl px-2.5 py-2 text-sm focus:border-wa-green focus:outline-none focus:ring-2 focus:ring-wa-green/20"
          >
            {PERIOD_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={ask}
            disabled={loading}
            className="bg-wa-green hover:bg-wa-dark disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-xl ml-auto"
          >
            {loading ? "Asking…" : "Ask AI"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm bg-brand-redTint border border-red-200 text-red-700 rounded-xl px-3 py-2">{error}</div>
      )}

      {loading && (
        <div className="text-sm text-slate-400 py-8 text-center">Generating your report…</div>
      )}

      {!loading && result && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">AI report</h3>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={toggleShare}
                  disabled={!hasNarrative}
                  className={`text-sm font-medium px-4 py-1.5 rounded-xl whitespace-nowrap border ${
                    shareOpen
                      ? "bg-wa-green/10 border-wa-green text-wa-dark"
                      : "border-slate-300 text-slate-700 hover:bg-slate-50"
                  } disabled:opacity-40`}
                >
                  Share to chat
                </button>
                <button
                  type="button"
                  onClick={downloadPdf}
                  disabled={pdfLoading}
                  className="border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 text-sm font-medium px-4 py-1.5 rounded-xl whitespace-nowrap"
                >
                  {pdfLoading ? "Preparing…" : "Download PDF"}
                </button>
              </div>
            </div>

            {shareOpen && (
              <div className="mt-3 border border-slate-200 rounded-xl p-3 bg-slate-50">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-600">Send this report to a teammate</p>
                  <button
                    type="button"
                    onClick={() => setShareOpen(false)}
                    className="text-xs text-slate-400 hover:text-slate-700"
                  >
                    Close
                  </button>
                </div>
                <input
                  value={shareQuery}
                  onChange={(e) => setShareQuery(e.target.value)}
                  placeholder="Search teammates…"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green/20"
                />
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {shareThreads === null ? (
                    <div className="px-3 py-3 text-xs text-slate-400 text-center">Loading…</div>
                  ) : filteredShareThreads.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-slate-400 text-center">No teammates found.</div>
                  ) : (
                    filteredShareThreads.map((t) => (
                      <button
                        key={t.threadId}
                        type="button"
                        disabled={sharingId !== null}
                        onClick={() => shareTo(t)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 border-b border-slate-100 last:border-0 disabled:opacity-50"
                      >
                        <span aria-hidden>{t.entityType === "team" ? "📢" : "👤"}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-slate-800 truncate">{t.label}</span>
                          <span className="block text-[11px] text-slate-400 truncate">{t.sublabel}</span>
                        </span>
                        {sharingId === t.entityId && <span className="text-xs text-slate-400 shrink-0">Sending…</span>}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {hasNarrative ? (
              <div className="mt-3">
                <Markdown text={result.narrative} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">The assistant didn&apos;t return a written summary for this question.</p>
            )}
          </div>

          {result.dataBlocks.map((block, i) => (
            <DataBlockCard key={i} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
