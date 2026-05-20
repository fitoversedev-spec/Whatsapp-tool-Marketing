"use client";

import { useState, useMemo } from "react";

type Recipient = {
  id: string;
  phoneE164: string;
  name: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-800",
  delivered: "bg-emerald-100 text-emerald-800",
  read: "bg-purple-100 text-purple-800",
  failed: "bg-red-100 text-red-800",
};

export default function RecipientsTable({ recipients }: { recipients: Recipient[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return recipients.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = `${r.phoneE164} ${r.name ?? ""} ${r.errorMessage ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [recipients, filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: recipients.length };
    for (const r of recipients) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [recipients]);

  if (recipients.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        No recipients have been enqueued yet.
      </div>
    );
  }

  return (
    <div>
      {/* Filters */}
      <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {["all", "queued", "sent", "delivered", "read", "failed"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                filter === s
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {s} {counts[s] !== undefined && <span className="opacity-70 ml-1">({counts[s]})</span>}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search by phone, name, or error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none text-sm"
        />
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-slate-100">
        {filtered.map((r) => (
          <div key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-slate-900 truncate">{r.name ?? "—"}</div>
                <div className="text-xs text-slate-500 font-mono">+{r.phoneE164}</div>
              </div>
              <span
                className={`shrink-0 inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                  STATUS_COLORS[r.status] ?? "bg-slate-100"
                }`}
              >
                {r.status}
              </span>
            </div>
            {r.errorMessage && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-2 break-words">
                {r.errorCode && <span className="font-mono mr-1">[{r.errorCode}]</span>}
                {r.errorMessage}
              </div>
            )}
            {(r.sentAt || r.deliveredAt || r.readAt) && (
              <div className="text-[10px] text-slate-400 mt-2 space-y-0.5">
                {r.sentAt && <div>Sent: {new Date(r.sentAt).toLocaleString()}</div>}
                {r.deliveredAt && <div>Delivered: {new Date(r.deliveredAt).toLocaleString()}</div>}
                {r.readAt && <div>Read: {new Date(r.readAt).toLocaleString()}</div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Sent</th>
              <th className="px-4 py-3 text-left">Delivered</th>
              <th className="px-4 py-3 text-left">Read</th>
              <th className="px-4 py-3 text-left">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-900">{r.name ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">+{r.phoneE164}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      STATUS_COLORS[r.status] ?? "bg-slate-100"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {r.deliveredAt ? new Date(r.deliveredAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {r.readAt ? new Date(r.readAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {r.errorMessage ? (
                    <div className="text-red-700">
                      {r.errorCode && <span className="font-mono mr-1">[{r.errorCode}]</span>}
                      {r.errorMessage}
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="p-8 text-center text-sm text-slate-500">
          No recipients match the filter.
        </div>
      )}
    </div>
  );
}
