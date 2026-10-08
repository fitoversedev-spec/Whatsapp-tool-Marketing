"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fmtDateTimeIST } from "@/lib/time";

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
  // Transient: the background sender is sending to this person right now.
  sending: "bg-blue-50 text-blue-700",
  sent: "bg-blue-100 text-blue-800",
  delivered: "bg-emerald-100 text-emerald-800",
  read: "bg-purple-100 text-purple-800",
  failed: "bg-red-100 text-red-800",
};

const SEARCH_DEBOUNCE_MS = 350;

// The server pages the recipients (100 a page) from the URL: ?status=&q=&page=.
// This table only shows the page it is given; the chips, search box and
// Previous / Next just change the URL.
export default function RecipientsTable({
  recipients,
  counts,
  status,
  q,
  page,
  pageCount,
}: {
  recipients: Recipient[];
  /** Per-status totals for the whole broadcast (not just this page), plus `all`. */
  counts: Record<string, number>;
  status: string;
  q: string;
  page: number;
  pageCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function go(next: { status?: string; q?: string; page?: number }) {
    const s = next.status ?? status;
    const query = next.q ?? q;
    const p = next.page ?? page;
    const params = new URLSearchParams();
    if (s !== "all") params.set("status", s);
    if (query) params.set("q", query);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function onSearch(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = value.trim();
      if (trimmed !== q) go({ q: trimmed, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  }

  // No recipients at all (not just none on this page / matching the filter).
  if ((counts.all ?? 0) === 0) {
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
              onClick={() => go({ status: s, page: 1 })}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                status === s
                  ? "bg-court-600 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {s} {counts[s] !== undefined && <span className="opacity-70 ml-1 font-mono">({counts[s]})</span>}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search by phone, name, or error…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="input text-sm"
        />
      </div>

      <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {recipients.map((r) => (
            <div key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{r.name ?? "—"}</div>
                  <div className="text-xs text-slate-500 font-mono">+{r.phoneE164}</div>
                </div>
                <span
                  className={`shrink-0 badge ${
                    STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-700"
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
                <div className="text-[10px] text-slate-400 mt-2 space-y-0.5 font-mono">
                  {r.sentAt && <div>Sent: {fmtDateTimeIST(r.sentAt)}</div>}
                  {r.deliveredAt && <div>Delivered: {fmtDateTimeIST(r.deliveredAt)}</div>}
                  {r.readAt && <div>Read: {fmtDateTimeIST(r.readAt)}</div>}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Name</th>
                <th className="text-left">Phone</th>
                <th className="text-left">Status</th>
                <th className="text-left">Sent</th>
                <th className="text-left">Delivered</th>
                <th className="text-left">Read</th>
                <th className="text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td className="text-slate-900">{r.name ?? "—"}</td>
                  <td className="text-slate-600 font-mono text-xs">+{r.phoneE164}</td>
                  <td>
                    <span
                      className={`badge ${
                        STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500 font-mono">
                    {r.sentAt ? fmtDateTimeIST(r.sentAt) : "—"}
                  </td>
                  <td className="text-xs text-slate-500 font-mono">
                    {r.deliveredAt ? fmtDateTimeIST(r.deliveredAt) : "—"}
                  </td>
                  <td className="text-xs text-slate-500 font-mono">
                    {r.readAt ? fmtDateTimeIST(r.readAt) : "—"}
                  </td>
                  <td className="text-xs">
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
      </div>

      {recipients.length === 0 && (
        <div className="p-8 text-center text-sm text-slate-500">
          No recipients match the filter.
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 p-4 border-t border-slate-100">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page <= 1 || pending}
            onClick={() => go({ page: page - 1 })}
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">
            Page <span className="font-mono">{page}</span> of <span className="font-mono">{pageCount}</span>
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page >= pageCount || pending}
            onClick={() => go({ page: page + 1 })}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
