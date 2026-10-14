"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { formatWhen } from "@/lib/agent/approvalFormat";
import type { ApprovalCard, ApprovalTab } from "@/lib/agent/approvalView";

const TABS: { key: ApprovalTab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "expired", label: "Expired" },
];

const EMPTY: Record<ApprovalTab, string> = {
  pending: "Nothing is waiting for you.",
  approved: "Nothing here yet.",
  rejected: "Nothing here yet.",
  expired: "Nothing here yet.",
};

const OUTCOME: Record<string, { label: string; cls: string }> = {
  done: { label: "Done", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "Did not go through", cls: "bg-red-100 text-red-700" },
  not_run: { label: "Not run", cls: "bg-amber-100 text-amber-800" },
  running: { label: "Running", cls: "bg-blue-100 text-blue-700" },
};

export default function AiApprovalsClient({
  initialItems,
  initialPendingCount,
}: {
  initialItems: ApprovalCard[];
  initialPendingCount: number;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<ApprovalTab>("pending");
  const [items, setItems] = useState<ApprovalCard[]>(initialItems);
  const [pendingCount, setPendingCount] = useState(initialPendingCount);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const latest = useRef(0);

  const load = useCallback(async (next: ApprovalTab) => {
    const ticket = ++latest.current;
    setLoading(true);
    setLoadError(false);
    const res = await safeFetch(`/api/admin/agent/approvals?status=${next}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (ticket !== latest.current) return; // a newer tab click won
    setLoading(false);
    if (!res.ok || !data) {
      setLoadError(true);
      return;
    }
    setItems(data.items as ApprovalCard[]);
    setPendingCount(data.pendingCount as number);
  }, []);

  // The first render already has the pending list from the server.
  useEffect(() => {
    if (tab !== "pending") void load(tab);
  }, [tab, load]);

  function pick(next: ApprovalTab) {
    if (next === tab) return;
    setItems([]);
    setTab(next);
    if (next === "pending") void load("pending");
  }

  async function decide(card: ApprovalCard, action: "approve" | "reject") {
    if (busyId) return;
    setBusyId(card.id);
    const typed = (notes[card.id] ?? "").trim();
    const note = action === "reject" ? typed || "No reason given." : typed;
    const res = await safeFetch(`/api/admin/agent/approvals/${card.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast.error((data as { error?: string }).error ?? "Something went wrong. Please try again.");
      // Someone else may have decided it already: show the real list.
      if (res.status === 409 || res.status === 410 || res.status === 404) void load(tab);
      return;
    }
    setItems((prev) => prev.filter((c) => c.id !== card.id));
    setPendingCount((n) => Math.max(0, n - 1));
    if (action === "reject") {
      toast.success("Rejected.");
    } else if (data.status === "executed") {
      toast.success("Approved and done.");
    } else if (data.status === "failed") {
      toast.error(`Approved, but it did not go through: ${data.failureReason ?? "unknown reason"}`);
    } else {
      toast.info("Approved. It cannot be run automatically yet, so nothing was changed.");
    }
  }

  return (
    <div className="min-h-full">
      <PageHeader
        title="AI approvals"
        description="Things the AI wants to do that need a person to say yes. Nothing happens until you approve."
        large
      />
      <div className="px-4 sm:px-6 lg:px-8 py-4 max-w-4xl">
        <div className="flex flex-wrap gap-2 mb-4" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => pick(t.key)}
              className={`btn ${tab === t.key ? "btn-primary" : "btn-secondary"}`}
            >
              {t.label}
              {t.key === "pending" && pendingCount > 0 && (
                <span className="ml-2 rounded-full bg-white/80 px-1.5 text-xs font-bold text-slate-900">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        {loadError ? (
          <div className="card p-6 text-sm text-slate-700">
            Could not load the list. Please try again.
            <button className="btn btn-secondary ml-3" onClick={() => void load(tab)}>
              Try again
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="card p-6 text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="card p-6 text-sm text-slate-500">{EMPTY[tab]}</div>
        ) : (
          <ul className="space-y-4">
            {items.map((c) => (
              <li key={c.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{c.title}</h2>
                  <div className="text-xs text-slate-500 sm:text-right">
                    <div>Asked {formatWhen(c.requestedAt)}</div>
                    {c.status === "pending" && <div>Expires {formatWhen(c.expiresAt)}</div>}
                  </div>
                </div>

                {c.customers.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {c.customers.map((p) => (
                      <li key={`${p.role}-${p.id}`} className="text-sm text-slate-800">
                        <span className="text-slate-500">{p.role}: </span>
                        <span className="font-semibold">{p.name ?? "(not found)"}</span>
                        {p.phone && <span className="text-slate-600"> · {p.phone}</span>}
                        {p.company && <span className="text-slate-600"> · {p.company}</span>}
                        <a href={p.href} target="_blank" rel="noreferrer" className="ml-2 text-blue-600 hover:underline">
                          Open
                        </a>
                      </li>
                    ))}
                  </ul>
                )}

                {c.details.length > 0 && (
                  <dl className="mt-3 space-y-2">
                    {c.details.map((d, i) => (
                      <div key={`${d.label}-${i}`} className={d.long ? "" : "flex flex-wrap gap-x-2"}>
                        <dt className="text-sm text-slate-500">{d.label}:</dt>
                        <dd
                          className={
                            d.long
                              ? "mt-1 rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-900 whitespace-pre-wrap break-words"
                              : "text-sm font-semibold text-slate-900 break-words"
                          }
                        >
                          {d.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {c.status === "pending" ? (
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <textarea
                      className="input w-full"
                      rows={2}
                      maxLength={500}
                      placeholder="Add a note (optional)"
                      value={notes[c.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                      disabled={busyId === c.id}
                    />
                    <div className="mt-3 flex gap-2">
                      <button className="btn btn-turf" disabled={busyId !== null} onClick={() => void decide(c, "approve")}>
                        {busyId === c.id ? "Working…" : "Approve"}
                      </button>
                      <button className="btn btn-secondary" disabled={busyId !== null} onClick={() => void decide(c, "reject")}>
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-slate-200 pt-3 text-sm text-slate-700 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold capitalize">{c.status}</span>
                      {c.outcome && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OUTCOME[c.outcome].cls}`}>
                          {OUTCOME[c.outcome].label}
                        </span>
                      )}
                      {c.decidedAt && (
                        <span className="text-slate-500">
                          by {c.decidedByName ?? "someone"} · {formatWhen(c.decidedAt)}
                        </span>
                      )}
                      {c.status === "expired" && !c.decidedAt && (
                        <span className="text-slate-500">on {formatWhen(c.expiresAt)}</span>
                      )}
                    </div>
                    {c.decisionNote && <div>Note: {c.decisionNote}</div>}
                    {c.failureReason && c.status !== "expired" && <div className="text-red-700">{c.failureReason}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
