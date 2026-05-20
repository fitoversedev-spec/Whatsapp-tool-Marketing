"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

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
};

type Template = { id: string; name: string; language: string; body: string };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
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
        description="Send approved templates to a Google Sheet of contacts."
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
                    <span
                      className={`shrink-0 inline-block px-2 py-1 rounded-md text-[10px] font-semibold uppercase ${
                        STATUS_COLORS[b.status] ?? "bg-slate-100"
                      }`}
                    >
                      {b.status}
                    </span>
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
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetRange, setSheetRange] = useState("Sheet1!A2:D");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [phoneColumn, setPhoneColumn] = useState("A");
  const [nameColumn, setNameColumn] = useState("B");
  const [var1Column, setVar1Column] = useState("B");
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function doPreview() {
    setBusy(true);
    const res = await fetch("/api/broadcasts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetUrl,
        sheetRange,
        phoneColumn,
        nameColumn,
        variableMapping: { "1": var1Column },
      }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return alert(data.error ?? "Preview failed");
    setPreview(data);
  }

  async function launch(e: FormEvent) {
    e.preventDefault();
    if (!preview) return alert("Preview first");
    setBusy(true);
    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        sheetUrl,
        sheetRange,
        templateId,
        phoneColumn,
        nameColumn,
        variableMapping: { "1": var1Column },
      }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return alert(data.error ?? "Launch failed");
    await fetch(`/api/broadcasts/${data.broadcast.id}/launch`, { method: "POST" });
    onLaunched();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <form
        onSubmit={launch}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 sm:p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">New broadcast</h2>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <Field label="Campaign name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="May Promo"
              required
            />
          </Field>

          <Field label="Google Sheet URL" required>
            <input
              type="url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              className="input"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              required
            />
          </Field>

          <Field label="Sheet range">
            <input value={sheetRange} onChange={(e) => setSheetRange(e.target.value)} className="input" />
          </Field>

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

          <div className="grid grid-cols-3 gap-3">
            <Field label="Phone col">
              <input
                value={phoneColumn}
                onChange={(e) => setPhoneColumn(e.target.value.toUpperCase())}
                className="input"
              />
            </Field>
            <Field label="Name col">
              <input
                value={nameColumn}
                onChange={(e) => setNameColumn(e.target.value.toUpperCase())}
                className="input"
              />
            </Field>
            <Field label="{{1}} col">
              <input
                value={var1Column}
                onChange={(e) => setVar1Column(e.target.value.toUpperCase())}
                className="input"
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={doPreview}
            disabled={busy}
            className="text-wa-dark font-medium text-sm underline"
          >
            {busy ? "Loading…" : "Preview recipients →"}
          </button>

          {preview && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm">
              <div className="font-medium text-slate-900 mb-2">Preview</div>
              <div className="grid grid-cols-3 gap-3 text-center mb-3">
                <PreviewStat label="Will send" value={preview.willSend} color="text-green-700" />
                <PreviewStat label="Opt-outs" value={preview.optOuts} color="text-amber-700" />
                <PreviewStat label="Invalid" value={preview.invalid} color="text-red-700" />
              </div>
              {preview.samples?.length > 0 && (
                <>
                  <div className="text-xs text-slate-500 mb-1">First 3:</div>
                  <ul className="space-y-1">
                    {preview.samples.slice(0, 3).map((s: any, i: number) => (
                      <li
                        key={i}
                        className="text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 break-words"
                      >
                        <span className="text-slate-400">+{s.phone}:</span> {s.preview}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

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
            disabled={busy || !preview}
            className="order-1 sm:order-2 bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg"
          >
            {busy ? "Launching…" : `Launch (${preview?.willSend ?? 0})`}
          </button>
        </div>
      </form>
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
          :global(.input) {
            font-size: 14px;
          }
        }
        :global(.input:focus) {
          border-color: #25d366;
          box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.2);
        }
      `}</style>
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
