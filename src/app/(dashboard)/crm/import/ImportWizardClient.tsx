"use client";

import { useState, ChangeEvent } from "react";
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { IMPORT_FIELDS, IMPORT_TARGET_LABELS, templateHeaders, autoMatchColumns, type ImportTarget } from "@/lib/import/mapping";

type Step = "target" | "upload" | "mapping" | "preview" | "result";

type PreviewRow = {
  rowIndex: number;
  status: "valid" | "invalid" | "duplicate";
  errors: string[];
  duplicateId?: string;
  duplicateLabel?: string;
  fields: Record<string, string>;
};

type PreviewResponse = {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  rows: PreviewRow[];
};

type CommitResponse = {
  batchId: string;
  successCount: number;
  skippedCount: number;
  errorCount: number;
  rowErrors: { rowIndex: number; errors: string[] }[];
};

// LEADS deliberately excluded — the Leads section it fed was removed
// (2026-07-20, see docs/DECISIONS.md). CONTACTS already captures everything
// it did, plus more. mapping.ts/dedupe.ts keep the LEADS-target logic intact
// (unreachable via this picker, not deleted) so it's a cheap restore if ever needed.
const TARGETS: ImportTarget[] = ["CONTACTS", "COMPANIES", "DEALS"];

export default function ImportWizardClient() {
  const toast = useToast();
  const [step, setStep] = useState<Step>("target");
  const [target, setTarget] = useState<ImportTarget>("CONTACTS");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<unknown[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "update" | "create">("skip");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommitResponse | null>(null);

  const headers = (rows[0] ?? []).map((h) => String(h ?? ""));

  function downloadTemplate(t: ImportTarget) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([templateHeaders(t)]);
    XLSX.utils.book_append_sheet(wb, ws, IMPORT_TARGET_LABELS[t]);
    XLSX.writeFile(wb, `${IMPORT_TARGET_LABELS[t].toLowerCase()}-import-template.xlsx`);
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const parsed: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (parsed.length < 2) {
        toast.error("That file has no data rows");
        return;
      }
      setRows(parsed);
      setFileName(file.name);
      const parsedHeaders = (parsed[0] ?? []).map((h) => String(h ?? ""));
      setColumnMap(autoMatchColumns(target, parsedHeaders));
      setStep("mapping");
    };
    reader.readAsBinaryString(file);
  }

  async function runPreview() {
    const missing = IMPORT_FIELDS[target].filter((f) => f.required && !columnMap[f.key]);
    if (missing.length) {
      toast.error(`Map a column for: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setLoading(true);
    const res = await fetch("/api/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, rows, columnMap }),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Could not validate the file"); return; }
    const data = await res.json();
    setPreview(data);
    setStep("preview");
  }

  async function runCommit() {
    setLoading(true);
    const res = await fetch("/api/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, fileName, rows, columnMap, duplicateAction }),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Import failed"); return; }
    const data = await res.json();
    setResult(data);
    setStep("result");
  }

  async function undoImport() {
    if (!result) return;
    const res = await fetch(`/api/import/${result.batchId}/undo`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Import undone");
      setResult(null);
      setStep("target");
      setRows([]);
      setColumnMap({});
      setPreview(null);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Could not undo");
    }
  }

  function reset() {
    setStep("target");
    setRows([]);
    setColumnMap({});
    setPreview(null);
    setResult(null);
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader title="Import" description="Bulk-load contacts, companies, leads, or deals from a spreadsheet" />

      {step === "target" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">What are you importing?</h3>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {TARGETS.map((t) => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className={`text-left p-3 rounded-lg border text-sm font-medium ${
                  target === t ? "border-wa-green bg-wa-green/5 text-wa-dark" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {IMPORT_TARGET_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm cursor-pointer">
              Choose file
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
            </label>
            <button onClick={() => downloadTemplate(target)} className="text-sm text-wa-dark hover:underline">
              Download template
            </button>
          </div>
        </div>
      )}

      {step === "mapping" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Map columns — {fileName}</h3>
            <span className="text-xs text-slate-500">{rows.length - 1} rows</span>
          </div>

          <div className="mb-4 border border-slate-200 rounded-lg overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-slate-50">{headers.map((h, i) => <th key={i} className="px-2 py-1.5 text-left font-medium text-slate-600 whitespace-nowrap">{h || `Column ${i + 1}`}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(1, 6).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {(r as unknown[]).map((c, j) => <td key={j} className="px-2 py-1 text-slate-600 whitespace-nowrap">{String(c ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 mb-5">
            {IMPORT_FIELDS[target].map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="text-sm text-slate-700 w-44 shrink-0">
                  {f.label}{f.required && <span className="text-red-500"> *</span>}
                </label>
                <select
                  value={columnMap[f.key] ?? ""}
                  onChange={(e) => setColumnMap((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="">Not mapped</option>
                  {headers.map((h, i) => <option key={i} value={h}>{h || `Column ${i + 1}`}</option>)}
                </select>
                {f.hint && <span className="text-xs text-slate-400 w-40 shrink-0">{f.hint}</span>}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={reset} className="border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-700">Start over</button>
            <button onClick={runPreview} disabled={loading} className="bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {loading ? "Validating..." : "Preview"}
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Validation preview</h3>
          <p className="text-sm text-slate-500 mb-4">
            {preview.validCount} ready · {preview.duplicateCount} possible duplicates · {preview.invalidCount} need fixing
          </p>

          {preview.duplicateCount > 0 && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-900 mb-2">How should duplicates be handled?</p>
              <div className="flex gap-3 text-xs">
                {(["skip", "update", "create"] as const).map((a) => (
                  <label key={a} className="flex items-center gap-1.5">
                    <input type="radio" checked={duplicateAction === a} onChange={() => setDuplicateAction(a)} />
                    {a === "skip" ? "Skip them" : a === "update" ? "Update existing" : "Create anyway"}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg mb-5">
            <table className="text-xs w-full">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-slate-600">Row</th>
                  <th className="px-2 py-1.5 text-left font-medium text-slate-600">Status</th>
                  <th className="px-2 py-1.5 text-left font-medium text-slate-600">Detail</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.rowIndex} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-500">{r.rowIndex + 2}</td>
                    <td className="px-2 py-1">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        r.status === "valid" ? "bg-green-100 text-green-700" : r.status === "duplicate" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                      }`}>
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-slate-600">
                      {r.status === "invalid" ? r.errors.join("; ") : r.status === "duplicate" ? `Matches "${r.duplicateLabel}"` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep("mapping")} className="border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-700">Back</button>
            <button
              onClick={runCommit}
              disabled={loading || preview.validCount + preview.duplicateCount === 0}
              className="bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Importing..." : `Import ${preview.validCount + (duplicateAction !== "skip" ? preview.duplicateCount : 0)} rows`}
            </button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Import complete</h3>
          <p className="text-sm text-slate-500 mb-4">
            {result.successCount} imported · {result.skippedCount} skipped · {result.errorCount} failed
          </p>
          {result.rowErrors.length > 0 && (
            <div className="mb-4 max-h-48 overflow-y-auto border border-red-200 bg-red-50 rounded-lg p-3 text-xs text-red-800">
              {result.rowErrors.map((e) => (
                <div key={e.rowIndex}>Row {e.rowIndex + 2}: {e.errors.join("; ")}</div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={reset} className="border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-700">Import another file</button>
            {result.successCount > 0 && (
              <button onClick={undoImport} className="text-sm text-red-600 hover:underline px-4 py-2">
                Undo this import
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
