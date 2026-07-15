"use client";

import { Fragment, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";

type Row = {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  diff: string | null;
  at: string;
  actorName: string | null;
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-700",
  UPDATE: "bg-blue-100 text-blue-700",
  DELETE: "bg-red-100 text-red-700",
  STAGE_CHANGE: "bg-purple-100 text-purple-700",
  SEND: "bg-amber-100 text-amber-700",
};

export default function AuditLogClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 50;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (entityFilter) params.set("entity", entityFilter);
    fetch(`/api/admin/audit-log?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setEntities(data.entities ?? []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, entityFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every stage change, role change, and taxonomy edit — who did what, when."
      />
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <select
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              setPage(1);
            }}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All entities</option>
            {entities.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          <span className="text-xs text-slate-400">{total} events</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">No audit events yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 text-xs uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Actor</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Entity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const expanded = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                      >
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{r.actorName ?? <span className="text-slate-400">system</span>}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${ACTION_COLORS[r.action] ?? "bg-slate-100 text-slate-600"}`}>
                            {r.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {r.entity} <span className="text-slate-400 text-xs">{r.entityId.slice(0, 8)}</span>
                        </td>
                      </tr>
                      {expanded && r.diff && (
                        <tr className="bg-slate-50">
                          <td colSpan={4} className="px-4 py-3">
                            <pre className="text-xs text-slate-600 whitespace-pre-wrap break-all">{JSON.stringify(JSON.parse(r.diff), null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-slate-500">Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}
