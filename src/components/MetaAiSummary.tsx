"use client";

// Phase 6 — Meta ad-campaign AI summaries (internal-assist, read-only).
// A freeform question goes to POST /api/ad-campaigns/summarize; the model
// answers ONLY by calling the real ad-campaign tools server-side, so every
// number rendered here comes back from a tool call — this component never
// computes or invents figures, it just displays the narrative + dataBlocks the
// route returns. Self-contained: default export, no required props, so it can
// be dropped straight onto the Ad Campaigns page.
import { useState } from "react";
import Markdown from "@/components/Markdown";

// Route response shape (fixed contract). `rows: unknown` because each ads tool
// returns its own shape — the flexible table below normalizes whatever comes
// back without assuming a schema.
type DataBlock = { tool: string; title: string; rows: unknown };
type SummaryResponse = { narrative: string; dataBlocks: DataBlock[] };

// Quick-pick chips just fill the question box — they don't submit. The label
// doubles as the question text so what the user sees is exactly what's asked.
const QUICK_PICKS = [
  "How are the ads performing this month?",
  "How many leads did we get last 7 days?",
  "Which campaign has the cheapest cost per lead?",
  "Where are we wasting ad spend?",
  "Best and worst campaigns this quarter",
];

function messageForStatus(status: number): string {
  if (status === 402) return "The AI credit has run out — please top up your Anthropic balance to keep using AI.";
  if (status === 401 || status === 403) return "You need to be signed in to use this.";
  if (status === 429) return "You've hit the daily AI limit (or it's rate-limited) — try again shortly.";
  if (status === 503) return "The AI service is temporarily unavailable. Please try again shortly.";
  if (status === 500) return "Something went wrong generating the summary. Please try again.";
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

// Normalizes a tool's `rows` into headers + a 2D string grid, handling the
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

function DataBlockCard({ block }: { block: DataBlock }) {
  const { headers, body } = normalizeRows(block.rows);
  return (
    <div className="card p-4">
      <h3 className="text-base font-semibold text-slate-900">{block.title}</h3>
      <div className="mt-3 overflow-x-auto">
        {body.length === 0 ? (
          <p className="text-sm text-slate-400">No data for this section.</p>
        ) : (
          <table className="data-table">
            {headers.length > 0 && (
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className="whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`whitespace-nowrap ${j === 0 ? "font-medium text-slate-900" : "text-slate-700"}`}
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

export default function MetaAiSummary() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummaryResponse | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q) {
      setError("Type a question first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ad-campaigns/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        setError(messageForStatus(res.status));
        return;
      }
      const data = (await res.json()) as SummaryResponse;
      setResult(data);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="text-base font-semibold text-slate-900">Ask AI about your ad campaigns</h3>
        <p className="text-sm text-slate-600 mt-1 mb-3">
          Ask in plain English. The assistant answers only from your real Meta ad data — every figure comes from the
          underlying campaign, spend and lead numbers, never made up.
        </p>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about your ad campaigns…"
          rows={3}
          className="input text-sm"
        />

        <div className="flex flex-wrap gap-1.5 mt-3">
          {QUICK_PICKS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuestion(q)}
              className="chip hover:bg-slate-50"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button
            type="button"
            onClick={ask}
            disabled={loading}
            className="btn btn-primary ml-auto"
          >
            {loading ? "Asking…" : "Ask AI"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm bg-brand-redTint border border-red-200 text-red-700 rounded-xl px-3 py-2">{error}</div>
      )}

      {loading && <div className="text-sm text-slate-400 py-8 text-center">Generating your summary…</div>}

      {!loading && result && (
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-base font-semibold text-slate-900 mb-3">AI summary</h3>
            {result.narrative.trim() ? (
              <Markdown text={result.narrative} />
            ) : (
              <p className="text-sm text-slate-400">The assistant didn&apos;t return a written summary for this question.</p>
            )}
          </div>

          {result.dataBlocks.length > 0 && (
            <details className="card px-4 py-3">
              <summary className="text-sm font-medium text-slate-600 cursor-pointer select-none marker:text-slate-400">
                Show the data behind this report
              </summary>
              <div className="mt-3 space-y-4">
                {result.dataBlocks.map((block, i) => (
                  <DataBlockCard key={i} block={block} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
