"use client";

import { useState, useEffect, useRef, FormEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import * as XLSX from "xlsx";

type Broadcast = {
  id: string;
  name: string;
  templateName: string;
  status: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  createdByName: string;
  createdAt: string;
  scheduledAt: string | null;
};

type Template = { id: string; name: string; language: string; body: string };

type FilterRule = { column: string; condition: "equals" | "contains" | "starts_with" | "not_empty"; value: string };
type ContactFilter = { field: string; condition: "equals" | "contains" | "starts_with" | "not_empty"; value: string };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  scheduled: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export default function BroadcastsClient({
  broadcasts,
  approvedTemplates,
}: {
  broadcasts: Broadcast[];
  approvedTemplates: Template[];
}) {
  const router = useRouter();
  const [showComposer, setShowComposer] = useState(false);

  return (
    <>
      <PageHeader
        title="Broadcasts"
        description="Send approved templates to a list of contacts."
        action={
          <button
            onClick={() => setShowComposer(true)}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg transition w-full sm:w-auto disabled:opacity-50"
            disabled={approvedTemplates.length === 0}
            title={approvedTemplates.length === 0 ? "No approved templates yet" : ""}
          >
            + New broadcast
          </button>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {broadcasts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center text-slate-500">
            No broadcasts yet. Click <strong>New broadcast</strong> to compose one.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {broadcasts.map((b) => (
                <Link
                  key={b.id}
                  href={`/broadcasts/${b.id}`}
                  className="block bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 active:bg-slate-50 transition"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{b.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{b.templateName}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`inline-block px-2 py-1 rounded-md text-[10px] font-semibold uppercase ${
                          STATUS_COLORS[b.status] ?? "bg-slate-100"
                        }`}
                      >
                        {b.status}
                      </span>
                      {b.status === "scheduled" && b.scheduledAt && (
                        <div className="text-[10px] text-amber-700 mt-1">
                          {new Date(b.scheduledAt).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-100 text-center">
                    <Stat label="Sent" value={`${b.sent}/${b.total}`} />
                    <Stat label="Delivered" value={b.delivered} />
                    <Stat label="Read" value={b.read} />
                    <Stat label="Failed" value={b.failed} color={b.failed > 0 ? "text-red-600" : undefined} />
                  </div>
                  <div className="text-xs text-slate-500 mt-3">by {b.createdByName}</div>
                </Link>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Template</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-right">Sent</th>
                      <th className="px-4 py-3 text-right">Delivered</th>
                      <th className="px-4 py-3 text-right">Read</th>
                      <th className="px-4 py-3 text-right">Failed</th>
                      <th className="px-4 py-3 text-left">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {broadcasts.map((b) => (
                      <tr
                        key={b.id}
                        onClick={() => router.push(`/broadcasts/${b.id}`)}
                        className="hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <Link href={`/broadcasts/${b.id}`} className="hover:underline">
                            {b.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{b.templateName}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-1 rounded-md text-[10px] font-semibold uppercase ${
                              STATUS_COLORS[b.status] ?? "bg-slate-100"
                            }`}
                          >
                            {b.status}
                          </span>
                          {b.status === "scheduled" && b.scheduledAt && (
                            <div className="text-[10px] text-amber-700 mt-1">
                              {new Date(b.scheduledAt).toLocaleString("en-IN", {
                                day: "numeric",
                                month: "short",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {b.sent} / {b.total}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">{b.delivered}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{b.read}</td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {b.failed > 0 ? (
                            <span className="text-red-600 font-medium">{b.failed}</span>
                          ) : (
                            0
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{b.createdByName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {showComposer && (
        <BroadcastComposer
          templates={approvedTemplates}
          onClose={() => setShowComposer(false)}
          onLaunched={() => {
            setShowComposer(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div>
      <div className={`text-sm font-bold ${color ?? "text-slate-900"}`}>{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

// ─── Broadcast Composer ───────────────────────────────────────────────────────

function BroadcastComposer({
  templates,
  onClose,
  onLaunched,
}: {
  templates: Template[];
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"file" | "sheet" | "contacts">("contacts");

  // Saved Contacts state
  const [contactFields, setContactFields] = useState<string[]>([]);
  const [contactTotal, setContactTotal] = useState(0);
  const [contactFilters, setContactFilters] = useState<ContactFilter[]>([]);
  const [contactVar1, setContactVar1] = useState("name");

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileRows, setFileRows] = useState<any[][] | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);

  // Google sheet state
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetRange, setSheetRange] = useState("Sheet1!A2:G");

  // Column mapping
  const [phoneColumn, setPhoneColumn] = useState("C");
  const [countryCodeColumn, setCountryCodeColumn] = useState("B");
  const [nameColumn, setNameColumn] = useState("A");
  const [var1Column, setVar1Column] = useState("A");

  // Filter rules
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);

  const [preview, setPreview] = useState<any>(null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Scheduling state — "now" sends immediately, "later" requires a datetime.
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");

  // Load saved-contact field keys for the filter + variable dropdowns
  useEffect(() => {
    fetch("/api/contacts/meta")
      .then((r) => (r.ok ? r.json() : { fields: [], totalContacts: 0 }))
      .then((d) => {
        setContactFields((d.fields ?? []).map((f: any) => f.key));
        setContactTotal(d.totalContacts ?? 0);
      })
      .catch(() => {});
  }, []);

  function addContactFilter() {
    setContactFilters((prev) => [...prev, { field: "", condition: "equals", value: "" }]);
    setPreview(null);
  }
  function updateContactFilter(index: number, key: keyof ContactFilter, value: string) {
    setContactFilters((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
    setPreview(null);
  }
  function removeContactFilter(index: number) {
    setContactFilters((prev) => prev.filter((_, i) => i !== index));
    setPreview(null);
  }

  // ── File Parsing ────────────────────────────────────────────────────────────
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      const wb = XLSX.read(data, { type: "binary" });
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      const firstSheet = wb.SheetNames[0];
      setSelectedSheet(firstSheet);
      loadSheet(wb, firstSheet);
      setFileLabel(`${file.name} — ${wb.SheetNames.length} sheet(s)`);
    };
    reader.readAsBinaryString(file);
  }

  function loadSheet(wb: XLSX.WorkBook, sheetName: string) {
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    setFileRows(rows);
    setPreview(null);
  }

  function onSheetSelect(sheetName: string) {
    setSelectedSheet(sheetName);
    if (workbook) loadSheet(workbook, sheetName);
  }

  // ── Filter Rule Helpers ─────────────────────────────────────────────────────
  function addFilter() {
    setFilterRules((prev) => [...prev, { column: "", condition: "equals", value: "" }]);
  }

  function updateFilter(index: number, field: keyof FilterRule, value: string) {
    setFilterRules((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function removeFilter(index: number) {
    setFilterRules((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Preview ─────────────────────────────────────────────────────────────────
  async function doPreview() {
    setBusy(true);

    // Saved Contacts source — preview against the contact pool
    if (source === "contacts") {
      const res = await fetch("/api/contacts/filter-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filterRules: contactFilters.filter((r) => r.field),
          variableMapping: { "1": contactVar1 },
        }),
      });
      setBusy(false);
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Preview failed"); return; }
      setPreview(data);
      return;
    }

    const payload: any = {
      phoneColumn,
      nameColumn,
      countryCodeColumn: countryCodeColumn || undefined,
      variableMapping: { "1": var1Column },
      filterRules: filterRules.filter((r) => r.column),
    };
    if (source === "file") {
      if (!fileRows) { setBusy(false); toast.error("Please upload a file first."); return; }
      payload.fileRows = fileRows;
    } else {
      payload.sheetUrl = sheetUrl;
      payload.sheetRange = sheetRange;
    }
    const res = await fetch("/api/broadcasts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Preview failed"); return; }
    setPreview(data);
  }

  // ── Launch ──────────────────────────────────────────────────────────────────
  async function launch(e: FormEvent) {
    e.preventDefault();
    if (!preview) { toast.error("Preview first"); return; }

    // Scheduling validation
    if (sendMode === "later") {
      if (!scheduledAt) { toast.error("Pick a schedule time"); return; }
      const target = new Date(scheduledAt);
      if (target.getTime() - Date.now() < 2 * 60 * 1000) {
        toast.error("Schedule must be at least 2 minutes in the future");
        return;
      }
    }

    setBusy(true);

    const payload: any = { name, templateId, sourceType: source };
    if (sendMode === "later" && scheduledAt) {
      payload.scheduledAt = new Date(scheduledAt).toISOString();
    }

    if (source === "contacts") {
      payload.variableMapping = { "1": contactVar1 };
      payload.filterRules = contactFilters
        .filter((r) => r.field)
        .map((r) => ({ field: r.field, condition: r.condition, value: r.value }));
    } else {
      payload.phoneColumn = phoneColumn;
      payload.nameColumn = nameColumn;
      payload.countryCodeColumn = countryCodeColumn || undefined;
      payload.variableMapping = { "1": var1Column };
      payload.filterRules = filterRules.filter((r) => r.column);
      if (source === "file") {
        payload.fileData = JSON.stringify(fileRows);
      } else {
        payload.sheetUrl = sheetUrl;
        payload.sheetRange = sheetRange;
      }
    }

    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Launch failed"); return; }

    if (sendMode === "later") {
      const when = new Date(scheduledAt).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      toast.success(`Scheduled for ${when} · ${preview.willSend} contacts`);
    } else {
      await fetch(`/api/broadcasts/${data.broadcast.id}/launch`, { method: "POST" });
      toast.success(`Broadcast launched to ${preview.willSend} contacts`);
    }
    onLaunched();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <form
        onSubmit={launch}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">New broadcast</h2>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Campaign Name */}
          <Field label="Campaign name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="May Promo — Salem"
              required
            />
          </Field>

          {/* Source Toggle */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Contact source</label>
            <div className="flex flex-wrap rounded-lg border border-slate-300 overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => { setSource("contacts"); setPreview(null); }}
                className={`px-4 py-2 text-sm font-medium transition ${source === "contacts" ? "bg-wa-green text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                📒 Saved Contacts
              </button>
              <button
                type="button"
                onClick={() => { setSource("file"); setPreview(null); }}
                className={`px-4 py-2 text-sm font-medium transition border-l border-slate-300 ${source === "file" ? "bg-wa-green text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                📁 Upload File
              </button>
              <button
                type="button"
                onClick={() => { setSource("sheet"); setPreview(null); }}
                className={`px-4 py-2 text-sm font-medium transition border-l border-slate-300 ${source === "sheet" ? "bg-wa-green text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                📊 Google Sheet
              </button>
            </div>
          </div>

          {/* Saved Contacts source */}
          {source === "contacts" && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="text-sm text-slate-700">
                Sending to your saved contact pool —{" "}
                <strong>{contactTotal} contact{contactTotal === 1 ? "" : "s"}</strong> available.
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Use the filters below to target a subset (e.g. Location equals Salem). No filters = the whole pool.
              </div>
              {contactTotal === 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                  No contacts saved yet. Go to the <strong>Contacts</strong> page and upload a file first.
                </div>
              )}
            </div>
          )}

          {/* File Upload */}
          {source === "file" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Excel / CSV file <span className="text-red-500">*</span>
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-wa-green hover:bg-green-50 transition"
              >
                {fileLabel ? (
                  <div className="text-sm text-slate-700">
                    <div className="text-wa-green font-semibold mb-1">✓ {fileLabel}</div>
                    <div className="text-slate-500">{fileRows ? fileRows.length - 1 : 0} data rows loaded</div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">
                    <div className="text-2xl mb-2">📂</div>
                    Click to upload <strong>.xlsx</strong>, <strong>.xls</strong> or <strong>.csv</strong>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* Sheet picker for multi-sheet files */}
              {sheetNames.length > 1 && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Sheet to use</label>
                  <select
                    value={selectedSheet}
                    onChange={(e) => onSheetSelect(e.target.value)}
                    className="input"
                  >
                    {sheetNames.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Column headers preview */}
              {fileRows && fileRows[0] && (
                <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-xs text-slate-500 mb-1 font-medium">Detected columns (row 1):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(fileRows[0] as string[]).map((h, i) => (
                      <span key={i} className="inline-block bg-white border border-slate-300 rounded px-2 py-0.5 text-xs text-slate-700">
                        <span className="text-slate-400 mr-1">{String.fromCharCode(65 + i)}:</span>{h || "(empty)"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Google Sheet */}
          {source === "sheet" && (
            <>
              <Field label="Google Sheet URL" required>
                <input
                  type="url"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  className="input"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  required={source === "sheet"}
                />
              </Field>
              <Field label="Sheet range">
                <input value={sheetRange} onChange={(e) => setSheetRange(e.target.value)} className="input" />
              </Field>
            </>
          )}

          {/* Template */}
          <Field label="Template" required>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="input"
              required
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
          </Field>

          {/* Column Mapping — file / sheet only */}
          {source !== "contacts" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Column mapping</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Name col">
                  <input
                    value={nameColumn}
                    onChange={(e) => { setNameColumn(e.target.value); setPreview(null); }}
                    className="input"
                    placeholder="A"
                  />
                </Field>
                <Field label="Country code col">
                  <input
                    value={countryCodeColumn}
                    onChange={(e) => { setCountryCodeColumn(e.target.value); setPreview(null); }}
                    className="input"
                    placeholder="B (optional)"
                  />
                </Field>
                <Field label="Phone col">
                  <input
                    value={phoneColumn}
                    onChange={(e) => { setPhoneColumn(e.target.value); setPreview(null); }}
                    className="input"
                    placeholder="C"
                  />
                </Field>
                <Field label="{'{{1}}'} col">
                  <input
                    value={var1Column}
                    onChange={(e) => { setVar1Column(e.target.value); setPreview(null); }}
                    className="input"
                    placeholder="A"
                  />
                </Field>
              </div>
            </div>
          )}

          {/* Variable mapping — contacts source */}
          {source === "contacts" && (
            <Field label="Template variable {'{{1}}'} maps to">
              <select
                value={contactVar1}
                onChange={(e) => { setContactVar1(e.target.value); setPreview(null); }}
                className="input"
              >
                <option value="name">name</option>
                {contactFields.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Field>
          )}

          {/* Filter Rules — file / sheet (column-based) */}
          {source !== "contacts" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700">
                  Filter contacts <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <button
                  type="button"
                  onClick={addFilter}
                  className="text-xs text-wa-green font-semibold hover:underline"
                >
                  + Add filter
                </button>
              </div>

              {filterRules.length === 0 && (
                <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg px-4 py-3">
                  No filters — all valid contacts will be included. Click <strong>+ Add filter</strong> to narrow down (e.g. only Salem).
                </div>
              )}

              <div className="space-y-2">
                {filterRules.map((rule, i) => (
                  <div key={i} className="flex gap-2 items-start bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-medium">Column</div>
                        <input
                          value={rule.column}
                          onChange={(e) => { updateFilter(i, "column", e.target.value); setPreview(null); }}
                          className="input text-sm"
                          placeholder="Attribute 1 or F"
                        />
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-medium">Condition</div>
                        <select
                          value={rule.condition}
                          onChange={(e) => { updateFilter(i, "condition", e.target.value); setPreview(null); }}
                          className="input text-sm bg-white"
                        >
                          <option value="equals">equals</option>
                          <option value="contains">contains</option>
                          <option value="starts_with">starts with</option>
                          <option value="not_empty">not empty</option>
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-medium">Value</div>
                        <input
                          value={rule.value}
                          onChange={(e) => { updateFilter(i, "value", e.target.value); setPreview(null); }}
                          className="input text-sm"
                          placeholder="Salem"
                          disabled={rule.condition === "not_empty"}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { removeFilter(i); setPreview(null); }}
                      className="mt-5 text-slate-400 hover:text-red-500 text-lg leading-none"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter Rules — saved contacts (field-based) */}
          {source === "contacts" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700">
                  Filter by field <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <button
                  type="button"
                  onClick={addContactFilter}
                  className="text-xs text-wa-green font-semibold hover:underline"
                >
                  + Add filter
                </button>
              </div>

              {contactFilters.length === 0 && (
                <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg px-4 py-3">
                  No filters — the whole pool ({contactTotal}) will be targeted. Add a filter to narrow down (e.g. Location equals Salem).
                </div>
              )}

              <div className="space-y-2">
                {contactFilters.map((rule, i) => (
                  <div key={i} className="flex gap-2 items-start bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-medium">Field</div>
                        <select
                          value={rule.field}
                          onChange={(e) => updateContactFilter(i, "field", e.target.value)}
                          className="input text-sm bg-white"
                        >
                          <option value="">Select…</option>
                          <option value="name">name</option>
                          {contactFields.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-medium">Condition</div>
                        <select
                          value={rule.condition}
                          onChange={(e) => updateContactFilter(i, "condition", e.target.value)}
                          className="input text-sm bg-white"
                        >
                          <option value="equals">equals</option>
                          <option value="contains">contains</option>
                          <option value="starts_with">starts with</option>
                          <option value="not_empty">not empty</option>
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-medium">Value</div>
                        <input
                          value={rule.value}
                          onChange={(e) => updateContactFilter(i, "value", e.target.value)}
                          className="input text-sm"
                          placeholder="Salem"
                          disabled={rule.condition === "not_empty"}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeContactFilter(i)}
                      className="mt-5 text-slate-400 hover:text-red-500 text-lg leading-none"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview Button */}
          <button
            type="button"
            onClick={doPreview}
            disabled={busy}
            className="text-wa-dark font-medium text-sm underline"
          >
            {busy ? "Loading…" : "Preview recipients →"}
          </button>

          {/* Preview Results */}
          {preview && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm">
              <div className="font-medium text-slate-900 mb-2">Preview</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-3">
                <PreviewStat label="Will send" value={preview.willSend} color="text-green-700" />
                <PreviewStat label="Filtered out" value={preview.filtered ?? 0} color="text-blue-700" />
                <PreviewStat label="Opt-outs" value={preview.optOuts} color="text-amber-700" />
                {preview.noConsent !== undefined ? (
                  <PreviewStat label="No consent" value={preview.noConsent} color="text-red-700" />
                ) : (
                  <PreviewStat label="Invalid" value={preview.invalid} color="text-red-700" />
                )}
              </div>
              {preview.samples?.length > 0 && (
                <>
                  <div className="text-xs text-slate-500 mb-1">First 3 matching contacts:</div>
                  <ul className="space-y-1">
                    {preview.samples.slice(0, 3).map((s: any, i: number) => (
                      <li
                        key={i}
                        className="text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 break-words"
                      >
                        <span className="text-slate-400">+{s.phone}</span>
                        {s.name && <span className="ml-1 font-medium">{s.name}</span>}
                        {s.preview && <span className="ml-1 text-slate-400">— {s.preview}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Send timing */}
          {preview && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                When to send
              </label>
              <div className="flex rounded-lg border border-slate-300 overflow-hidden w-fit mb-2">
                <button
                  type="button"
                  onClick={() => setSendMode("now")}
                  className={`px-4 py-2 text-sm font-medium transition ${
                    sendMode === "now" ? "bg-wa-green text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  ⚡ Send now
                </button>
                <button
                  type="button"
                  onClick={() => setSendMode("later")}
                  className={`px-4 py-2 text-sm font-medium transition border-l border-slate-300 ${
                    sendMode === "later" ? "bg-wa-green text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  📅 Schedule
                </button>
              </div>
              {sendMode === "later" && (
                <div className="space-y-2">
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    min={(() => {
                      const d = new Date(Date.now() + 5 * 60 * 1000);
                      const pad = (n: number) => String(n).padStart(2, "0");
                      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    })()}
                    className="input"
                  />
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    ⚠ On Vercel Hobby plan, scheduled broadcasts may fire up to 1 hour later than the
                    selected time. Active dashboard tabs trigger an on-load check that catches due
                    broadcasts faster.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 sm:p-6 border-t border-slate-200 flex flex-col sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="order-2 sm:order-1 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !preview || (sendMode === "later" && !scheduledAt)}
            className="order-1 sm:order-2 bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg"
          >
            {busy
              ? sendMode === "later"
                ? "Scheduling…"
                : "Launching…"
              : sendMode === "later"
                ? `Schedule (${preview?.willSend ?? 0} contacts)`
                : `Launch (${preview?.willSend ?? 0} contacts)`}
          </button>
        </div>

        <style jsx>{`
          :global(.input) {
            width: 100%;
            padding: 0.625rem 0.75rem;
            border-radius: 0.5rem;
            border: 1px solid #cbd5e1;
            outline: none;
            font-size: 16px;
          }
          @media (min-width: 640px) {
            :global(.input) { font-size: 14px; }
          }
          :global(.input:focus) {
            border-color: #25d366;
            box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.2);
          }
          :global(.input:disabled) {
            background: #f8fafc;
            color: #94a3b8;
          }
        `}</style>
      </form>
    </div>
  );
}

function PreviewStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
