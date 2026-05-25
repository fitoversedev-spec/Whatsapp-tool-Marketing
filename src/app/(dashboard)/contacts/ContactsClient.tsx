"use client";

import { useState, useEffect, useCallback, useRef, FormEvent, ChangeEvent } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { analyzeFile, Detection } from "@/lib/file-analysis";
import * as XLSX from "xlsx";

const ROLE_META: Record<Detection["role"], { label: string; icon: string }> = {
  phone: { label: "Phone", icon: "📞" },
  countryCode: { label: "Country code", icon: "🌍" },
  name: { label: "Name", icon: "👤" },
  allowCampaign: { label: "AllowCampaign", icon: "✅" },
};

const CONFIDENCE_DOT: Record<string, string> = {
  high: "bg-green-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

type Contact = {
  id: string;
  phone: string;
  name: string | null;
  allowCampaign: boolean;
  fields: Record<string, string>;
  createdAt: string;
};

function ConsentBadge({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 whitespace-nowrap">
      ✓ CAMPAIGN
    </span>
  ) : (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 whitespace-nowrap">
      ✕ NO CAMPAIGN
    </span>
  );
}

export default function ContactsClient({
  initialContacts,
  total,
  fieldKeys,
}: {
  initialContacts: Contact[];
  total: number;
  fieldKeys: string[];
}) {
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [totalCount, setTotalCount] = useState(total);
  const [keys, setKeys] = useState<string[]>(fieldKeys);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [filterField, setFilterField] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [loading, setLoading] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const load = useCallback(
    async (opts?: { page?: number }) => {
      setLoading(true);
      const p = opts?.page ?? 1;
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterField && filterValue) {
        params.set("field", filterField);
        params.set("value", filterValue);
      }
      params.set("page", String(p));
      const res = await fetch(`/api/contacts?${params}`);
      setLoading(false);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts);
        setTotalCount(data.total);
        setTotalPages(data.totalPages);
        setPage(data.page);
      }
    },
    [search, filterField, filterValue]
  );

  // Debounced reload on search/filter change
  useEffect(() => {
    const t = setTimeout(() => load({ page: 1 }), 300);
    return () => clearTimeout(t);
  }, [search, filterField, filterValue, load]);

  function refreshAll() {
    load({ page: 1 });
    fetch("/api/contacts/meta")
      .then((r) => r.json())
      .then((d) => setKeys(d.fields?.map((f: any) => f.key) ?? []))
      .catch(() => {});
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${totalCount} contact${totalCount === 1 ? "" : "s"} in your pool. Upload once, reuse for any broadcast.`}
        action={
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowAdd(true)}
              className="flex-1 sm:flex-none border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium px-4 py-2 rounded-lg transition"
            >
              + Add
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="flex-1 sm:flex-none bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg transition"
            >
              Upload file
            </button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {/* Search + filter */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search phone or name…"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none text-sm"
          />
          <select
            value={filterField}
            onChange={(e) => {
              setFilterField(e.target.value);
              setFilterValue("");
            }}
            className="px-3 py-2 rounded-lg border border-slate-300 focus:border-wa-green outline-none text-sm bg-white"
          >
            <option value="">Filter by field…</option>
            {keys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {filterField && (
            <input
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              placeholder={`${filterField} equals…`}
              className="px-3 py-2 rounded-lg border border-slate-300 focus:border-wa-green outline-none text-sm"
            />
          )}
        </div>

        {contacts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center text-slate-500">
            {search || filterField
              ? "No contacts match your search/filter."
              : "No contacts yet. Click "}
            {!search && !filterField && <strong>Upload file</strong>}
            {!search && !filterField && " to import your contact list."}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {contacts.map((c) => (
                <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {c.name || "(no name)"}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">+{c.phone}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <ConsentBadge allowed={c.allowCampaign} />
                      <button
                        onClick={() => setEditing(c)}
                        className="text-xs text-slate-600 hover:text-slate-900 underline"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                  {Object.keys(c.fields).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1.5">
                      {Object.entries(c.fields).map(([k, v]) => (
                        <span
                          key={k}
                          className="inline-block bg-slate-100 rounded px-2 py-0.5 text-[11px] text-slate-600"
                        >
                          <span className="text-slate-400">{k}:</span> {v || "—"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Phone</th>
                      <th className="px-4 py-3 text-left">Campaign</th>
                      {keys.map((k) => (
                        <th key={k} className="px-4 py-3 text-left">
                          {k}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {contacts.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {c.name || <span className="text-slate-400">(no name)</span>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">+{c.phone}</td>
                        <td className="px-4 py-2.5">
                          <ConsentBadge allowed={c.allowCampaign} />
                        </td>
                        {keys.map((k) => (
                          <td key={k} className="px-4 py-2.5 text-slate-600">
                            {c.fields[k] || <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => setEditing(c)}
                            className="text-xs text-slate-600 hover:text-slate-900 underline"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  onClick={() => load({ page: page - 1 })}
                  disabled={page <= 1 || loading}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-md disabled:opacity-40 hover:bg-slate-50"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => load({ page: page + 1 })}
                  disabled={page >= totalPages || loading}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-md disabled:opacity-40 hover:bg-slate-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onDone={(msg) => {
            toast.success(msg);
            setShowUpload(false);
            refreshAll();
          }}
        />
      )}
      {showAdd && (
        <ContactFormModal
          mode="add"
          fieldKeys={keys}
          onClose={() => setShowAdd(false)}
          onDone={() => {
            toast.success("Contact added");
            setShowAdd(false);
            refreshAll();
          }}
        />
      )}
      {editing && (
        <ContactFormModal
          mode="edit"
          contact={editing}
          fieldKeys={keys}
          onClose={() => setEditing(null)}
          onDone={(deleted) => {
            toast.success(deleted ? "Contact deleted" : "Contact updated");
            setEditing(null);
            refreshAll();
          }}
        />
      )}
    </>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

function UploadModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<any[][] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileLabel, setFileLabel] = useState("");
  const [phoneCol, setPhoneCol] = useState("");
  const [ccCol, setCcCol] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [allowCol, setAllowCol] = useState("");
  const [fieldCols, setFieldCols] = useState<string[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [meta, setMeta] = useState<{ rowCount: number; columnCount: number } | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [busy, setBusy] = useState(false);

  // Source: file upload OR Google Sheet
  const [source, setSource] = useState<"file" | "sheet">("file");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetRange, setSheetRange] = useState("Sheet1");
  const [loadingSheet, setLoadingSheet] = useState(false);

  // Shared: take parsed rows, run the analyzer, populate the mapping state
  function applyParsedRows(parsed: any[][], label: string) {
    setRows(parsed);
    setFileLabel(label);
    const analysis = analyzeFile(parsed);
    setHeaders(analysis.headers);
    setPhoneCol(analysis.phoneColumn);
    setCcCol(analysis.countryCodeColumn);
    setNameCol(analysis.nameColumn);
    setAllowCol(analysis.allowCampaignColumn);
    setFieldCols(analysis.fieldColumns);
    setDetections(analysis.detections);
    setMeta({ rowCount: analysis.rowCount, columnCount: analysis.columnCount });
    setShowAdjust(false);
  }

  function resetParsed() {
    setRows(null);
    setHeaders([]);
    setFileLabel("");
    setDetections([]);
    setMeta(null);
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const parsed: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      applyParsedRows(parsed, `${file.name} — ${parsed.length - 1} rows`);
    };
    reader.readAsBinaryString(file);
  }

  async function loadSheet() {
    if (!sheetUrl.trim()) {
      toast.error("Paste a Google Sheet URL first");
      return;
    }
    setLoadingSheet(true);
    try {
      const res = await fetch("/api/contacts/read-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetUrl: sheetUrl.trim(),
          sheetRange: sheetRange.trim() || "Sheet1",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not read sheet");
        return;
      }
      applyParsedRows(data.rows, `Google Sheet — ${data.rowCount} rows`);
    } catch {
      toast.error("Network error reading sheet");
    } finally {
      setLoadingSheet(false);
    }
  }

  function toggleFieldCol(h: string) {
    setFieldCols((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]));
  }

  async function doImport(e: FormEvent) {
    e.preventDefault();
    if (!rows) {
      toast.error("Load a file or Google Sheet first");
      return;
    }
    if (!phoneCol) {
      toast.error("Select the phone column");
      return;
    }
    setBusy(true);
    const fieldColumns: Record<string, string> = {};
    for (const h of fieldCols) fieldColumns[h] = h;
    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows,
        phoneColumn: phoneCol,
        countryCodeColumn: ccCol || undefined,
        nameColumn: nameCol || undefined,
        allowCampaignColumn: allowCol || undefined,
        fieldColumns,
      }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Import failed");
      return;
    }
    onDone(
      `Imported: ${data.added} added, ${data.updated} updated` +
        (data.blocked ? `, ${data.blocked} marked no-campaign` : "") +
        (data.invalid ? `, ${data.invalid} invalid skipped` : "")
    );
  }

  return (
    <ModalShell title="Import contacts" onClose={onClose} wide>
      <form onSubmit={doImport} className="space-y-4">
        {/* Source toggle */}
        <div className="flex rounded-lg border border-slate-300 overflow-hidden w-fit">
          <button
            type="button"
            onClick={() => {
              setSource("file");
              resetParsed();
            }}
            className={`px-4 py-2 text-sm font-medium transition ${
              source === "file" ? "bg-wa-green text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            📁 Upload File
          </button>
          <button
            type="button"
            onClick={() => {
              setSource("sheet");
              resetParsed();
            }}
            className={`px-4 py-2 text-sm font-medium transition border-l border-slate-300 ${
              source === "sheet" ? "bg-wa-green text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            📊 Google Sheet
          </button>
        </div>

        {/* File upload */}
        {source === "file" && (
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-wa-green hover:bg-green-50 transition"
          >
            {fileLabel ? (
              <div className="text-sm text-wa-green font-semibold">✓ {fileLabel}</div>
            ) : (
              <div className="text-sm text-slate-500">
                <div className="text-2xl mb-1">📂</div>
                Click to upload <strong>.xlsx</strong>, <strong>.xls</strong> or <strong>.csv</strong>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFile}
            />
          </div>
        )}

        {/* Google Sheet */}
        {source === "sheet" && (
          <div className="space-y-3">
            <Field label="Google Sheet URL" required>
              <input
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                className="cinput"
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
            </Field>
            <Field label="Tab / range">
              <input
                value={sheetRange}
                onChange={(e) => setSheetRange(e.target.value)}
                className="cinput"
                placeholder="Sheet1"
              />
            </Field>
            <button
              type="button"
              onClick={loadSheet}
              disabled={loadingSheet}
              className="bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {loadingSheet ? "Loading…" : "Load sheet"}
            </button>
            {fileLabel && (
              <div className="text-sm text-wa-green font-semibold">✓ {fileLabel}</div>
            )}
            <div className="text-xs text-slate-500">
              The sheet must be shared with the service account. The range should include the
              header row — <strong>Sheet1</strong> reads the whole tab.
            </div>
          </div>
        )}

        {/* Detection summary */}
        {detections.length > 0 && meta && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3.5">
            <div className="text-sm font-semibold text-blue-900 mb-2.5">
              🔍 Analyzed — {meta.rowCount} rows, {meta.columnCount} columns
            </div>
            <div className="space-y-1.5">
              {detections.map((d) => (
                <div key={d.role} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${CONFIDENCE_DOT[d.confidence]}`}
                    title={`${d.confidence} confidence`}
                  />
                  <span className="font-medium text-slate-700 w-32 shrink-0">
                    {ROLE_META[d.role].icon} {ROLE_META[d.role].label}
                  </span>
                  <span className="text-slate-900 font-medium truncate">
                    {d.column} <span className="text-slate-400">({d.letter})</span>
                  </span>
                  <span className="text-slate-400 truncate hidden sm:inline">— {d.reason}</span>
                </div>
              ))}
              {fieldCols.length > 0 && (
                <div className="flex items-start gap-2 text-xs pt-1">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-slate-300 mt-1" />
                  <span className="font-medium text-slate-700 w-32 shrink-0">🏷 Saved as fields</span>
                  <span className="text-slate-600">{fieldCols.join(", ")}</span>
                </div>
              )}
            </div>
            {!phoneCol && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                ⚠ Couldn&apos;t auto-detect the phone column — please set it under &quot;Adjust mapping&quot;.
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowAdjust((v) => !v)}
              className="text-xs text-blue-700 font-medium hover:underline mt-2.5"
            >
              {showAdjust ? "Hide mapping ▴" : "Adjust mapping ▾"}
            </button>
          </div>
        )}

        {headers.length > 0 && (showAdjust || !phoneCol) && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Phone column" required>
                <select value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)} className="cinput">
                  <option value="">Select…</option>
                  {headers.map((h, i) => (
                    <option key={i} value={h}>
                      {h || `(col ${i + 1})`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Country code col">
                <select value={ccCol} onChange={(e) => setCcCol(e.target.value)} className="cinput">
                  <option value="">None</option>
                  {headers.map((h, i) => (
                    <option key={i} value={h}>
                      {h || `(col ${i + 1})`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name column">
                <select value={nameCol} onChange={(e) => setNameCol(e.target.value)} className="cinput">
                  <option value="">None</option>
                  {headers.map((h, i) => (
                    <option key={i} value={h}>
                      {h || `(col ${i + 1})`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="AllowCampaign col">
                <select value={allowCol} onChange={(e) => setAllowCol(e.target.value)} className="cinput">
                  <option value="">None</option>
                  {headers.map((h, i) => (
                    <option key={i} value={h}>
                      {h || `(col ${i + 1})`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {allowCol && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 text-xs text-green-800">
                ✓ Consent gate active — contacts where <strong>{allowCol}</strong> is FALSE will be saved
                but never receive a broadcast.
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Extra fields to save{" "}
                <span className="text-slate-400 font-normal">(tap columns like Location, Category)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {headers
                  .filter((h) => h && h !== phoneCol && h !== ccCol && h !== nameCol && h !== allowCol)
                  .map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => toggleFieldCol(h)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                        fieldCols.includes(h)
                          ? "bg-wa-green text-white border-wa-green"
                          : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {fieldCols.includes(h) ? "✓ " : ""}
                      {h}
                    </button>
                  ))}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
              Existing numbers are <strong>updated</strong> (not duplicated). Invalid phone rows are skipped.
            </div>
          </>
        )}

        <ModalActions confirmLabel={busy ? "Importing…" : "Import contacts"} disabled={busy || !rows} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

// ─── Add / Edit Contact Modal ─────────────────────────────────────────────────

function ContactFormModal({
  mode,
  contact,
  fieldKeys,
  onClose,
  onDone,
}: {
  mode: "add" | "edit";
  contact?: Contact;
  fieldKeys: string[];
  onClose: () => void;
  onDone: (deleted?: boolean) => void;
}) {
  const toast = useToast();
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [name, setName] = useState(contact?.name ?? "");
  const [allowCampaign, setAllowCampaign] = useState(contact?.allowCampaign ?? true);
  const [fields, setFields] = useState<Record<string, string>>(contact?.fields ?? {});
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);

  // Ensure all known field keys appear as editable rows
  const allKeys = Array.from(new Set([...fieldKeys, ...Object.keys(fields)]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "add") {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name || null, allowCampaign, fields }),
      });
      setBusy(false);
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Failed to add");
      onDone();
    } else {
      const res = await fetch(`/api/contacts/${contact!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || null, allowCampaign, fields }),
      });
      setBusy(false);
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Failed to update");
      onDone();
    }
  }

  async function remove() {
    if (!contact) return;
    setBusy(true);
    const res = await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onDone(true);
    else toast.error("Delete failed");
  }

  return (
    <ModalShell title={mode === "add" ? "Add contact" : "Edit contact"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Phone (with country code)" required>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={mode === "edit"}
            placeholder="919876543210"
            required
            className="cinput disabled:bg-slate-100 disabled:text-slate-500"
          />
        </Field>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="cinput" />
        </Field>

        <label className="flex items-center gap-2.5 cursor-pointer bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
          <input
            type="checkbox"
            checked={allowCampaign}
            onChange={(e) => setAllowCampaign(e.target.checked)}
            className="w-4 h-4 accent-wa-green"
          />
          <span className="text-sm text-slate-700">
            Allow campaign messages
            <span className="block text-xs text-slate-500">
              Unchecked = saved but never included in any broadcast
            </span>
          </span>
        </label>

        {allKeys.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-slate-700">Fields</div>
            {allKeys.map((k) => (
              <div key={k} className="flex gap-2 items-center">
                <span className="text-xs text-slate-500 w-28 shrink-0 truncate">{k}</span>
                <input
                  value={fields[k] ?? ""}
                  onChange={(e) => setFields((prev) => ({ ...prev, [k]: e.target.value }))}
                  className="cinput flex-1"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-center">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="New field name (e.g. Location)"
            className="cinput flex-1"
          />
          <button
            type="button"
            onClick={() => {
              if (newKey.trim()) {
                setFields((prev) => ({ ...prev, [newKey.trim()]: "" }));
                setNewKey("");
              }
            }}
            className="px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg font-medium text-slate-700 shrink-0"
          >
            + Field
          </button>
        </div>

        <div className="pt-4 border-t border-slate-200 -mx-5 sm:-mx-6 px-5 sm:px-6 flex flex-col sm:flex-row sm:justify-between gap-2">
          {mode === "edit" ? (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="order-3 sm:order-1 text-sm text-red-600 hover:text-red-700 px-3 py-2.5"
            >
              Delete contact
            </button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={onClose}
              className="order-2 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="order-1 sm:order-3 bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg"
            >
              {busy ? "Saving…" : mode === "add" ? "Add contact" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Shared modal shell ───────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div
        className={`bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full ${
          wide ? "sm:max-w-xl" : "sm:max-w-md"
        } max-h-[95vh] overflow-y-auto`}
      >
        <div className="p-5 sm:p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">{title}</h2>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
      <style jsx>{`
        :global(.cinput) {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          outline: none;
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(.cinput) {
            font-size: 14px;
          }
        }
        :global(.cinput:focus) {
          border-color: #25d366;
          box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.2);
        }
      `}</style>
    </div>
  );
}

function ModalActions({
  confirmLabel,
  disabled,
  onClose,
}: {
  confirmLabel: string;
  disabled?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="pt-4 border-t border-slate-200 -mx-5 sm:-mx-6 px-5 sm:px-6 flex flex-col sm:flex-row sm:justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="order-2 sm:order-1 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="order-1 sm:order-2 bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg"
      >
        {confirmLabel}
      </button>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
