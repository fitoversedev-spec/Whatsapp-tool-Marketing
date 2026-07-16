"use client";

import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

const TABS: { type: string; label: string }[] = [
  { type: "funnel-stages", label: "Funnel Stages" },
  { type: "lead-sources", label: "Lead Sources" },
  { type: "customer-profiles", label: "Customer Profiles" },
  { type: "city-tiers", label: "City Tiers" },
  { type: "loss-reasons", label: "Loss Reasons" },
  { type: "activity-types", label: "Activity Types" },
];

type Row = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  colorHex: string | null;
  stageType?: "active" | "won" | "lost";
  requiresLossReason?: boolean;
  parentId?: string | null;
  // Funnel-stage only. slaHours drives Team Performance's "stuck deal"
  // detection (falls back to a hardcoded default when null — see
  // src/lib/analytics/timelines.ts); probabilityPercent weights the
  // Forecast view's pipeline value (stays unweighted/"—" per stage when
  // null — see src/lib/analytics/forecast.ts). Both were DB-only fields
  // with no admin UI until now, so every stage left them null forever.
  slaHours?: number | null;
  probabilityPercent?: number | null;
};

const SWATCHES = ["#64748b", "#3b82f6", "#a855f7", "#f59e0b", "#f97316", "#10b981", "#ef4444"];

// Mirrors src/lib/analytics/timelines.ts's DEFAULT_SLA_HOURS — shown as the
// input placeholder so admins see what an unset stage currently falls back
// to, without importing server code into this client component.
const DEFAULT_SLA_HOURS = 72;

// A number input that only commits on blur/Enter, not per keystroke —
// patchRow triggers a full table reload (loading:true swaps the whole
// <table> for a placeholder), which would drop focus mid-type if this
// fired on every onChange like the color/checkbox cells do.
function NumberCell({
  value,
  onCommit,
  placeholder,
}: {
  value: number | null | undefined;
  onCommit: (v: number | null) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value != null ? String(value) : "");
  useEffect(() => {
    setText(value != null ? String(value) : "");
  }, [value]);

  function commit() {
    const trimmed = text.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    const next = parsed != null && Number.isFinite(parsed) ? parsed : null;
    if (next !== (value ?? null)) onCommit(next);
    else setText(value != null ? String(value) : "");
  }

  return (
    <input
      type="number"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      className="w-20 text-xs border border-slate-200 rounded px-1.5 py-1"
    />
  );
}

export default function TaxonomyClient() {
  const toast = useToast();
  const [tab, setTab] = useState(TABS[0].type);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");

  const load = useCallback(async (type: string) => {
    setLoading(true);
    const res = await fetch(`/api/admin/taxonomy/${type}`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.rows);
    } else {
      toast.error("Failed to load");
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  async function addRow() {
    if (!newName.trim()) return;
    const res = await fetch(`/api/admin/taxonomy/${tab}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        ...(tab === "funnel-stages" ? { stageType: "active" } : {}),
      }),
    });
    if (res.ok) {
      setNewName("");
      load(tab);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Create failed");
    }
  }

  async function patchRow(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/taxonomy/${tab}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      load(tab);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Update failed");
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Taxonomies"
        description="Every list below is editable here — nothing about stages, sources, or categories is hardcoded in the app."
      />

      <div className="flex flex-wrap gap-1.5 mb-4 mt-4">
        {TABS.map((t) => (
          <button
            key={t.type}
            onClick={() => setTab(t.type)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === t.type ? "bg-wa-green text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 font-medium">Color</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                {tab === "funnel-stages" && <th className="px-4 py-2.5 font-medium">Type</th>}
                {tab === "funnel-stages" && <th className="px-4 py-2.5 font-medium">Needs reason</th>}
                {tab === "funnel-stages" && <th className="px-4 py-2.5 font-medium">SLA (hrs)</th>}
                {tab === "funnel-stages" && <th className="px-4 py-2.5 font-medium">Win prob %</th>}
                <th className="px-4 py-2.5 font-medium">Active</th>
                <th className="px-4 py-2.5 font-medium">Order</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      {SWATCHES.map((c) => (
                        <button
                          key={c}
                          onClick={() => patchRow(r.id, { colorHex: c })}
                          className={`w-4 h-4 rounded-full ${r.colorHex === c ? "ring-2 ring-offset-1 ring-slate-400" : ""}`}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-800">{r.name}</td>
                  {tab === "funnel-stages" && (
                    <td className="px-4 py-2.5">
                      <select
                        value={r.stageType}
                        onChange={(e) => patchRow(r.id, { stageType: e.target.value })}
                        className="text-xs border border-slate-200 rounded px-1.5 py-1"
                      >
                        <option value="active">active</option>
                        <option value="won">won</option>
                        <option value="lost">lost</option>
                      </select>
                    </td>
                  )}
                  {tab === "funnel-stages" && (
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={!!r.requiresLossReason}
                        onChange={(e) => patchRow(r.id, { requiresLossReason: e.target.checked })}
                      />
                    </td>
                  )}
                  {tab === "funnel-stages" && (
                    <td className="px-4 py-2.5">
                      <NumberCell
                        value={r.slaHours}
                        placeholder={String(DEFAULT_SLA_HOURS)}
                        onCommit={(v) => patchRow(r.id, { slaHours: v })}
                      />
                    </td>
                  )}
                  {tab === "funnel-stages" && (
                    <td className="px-4 py-2.5">
                      <NumberCell
                        value={r.probabilityPercent}
                        placeholder="—"
                        onCommit={(v) => patchRow(r.id, { probabilityPercent: v })}
                      />
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={r.isActive} onChange={(e) => patchRow(r.id, { isActive: e.target.checked })} />
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{r.sortOrder}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="p-3 border-t border-slate-200 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRow()}
            placeholder="Add new…"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
          <button onClick={addRow} className="bg-wa-green hover:bg-wa-green/90 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
