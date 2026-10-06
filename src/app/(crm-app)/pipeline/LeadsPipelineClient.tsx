"use client";

// Kanban (and funnel) of leads by sales stage. Drag a card to another column,
// or use its stage dropdown (handy on a phone), to move it — same
// PATCH /api/account-contacts/[id] { leadStageId } the contact page uses.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type Stage = { id: string; name: string; colorHex: string | null; isActive: boolean };
type Card = {
  id: string;
  name: string;
  phone: string | null;
  company: string;
  city: string | null;
  rep: string | null;
  stageId: string | null;
  createdAt: string;
  canEdit: boolean;
};

const NO_STAGE = "__none__";

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default function LeadsPipelineClient({
  view, owner, reps, stages, cards: initialCards,
}: {
  view: "kanban" | "funnel";
  owner: string;
  reps: { id: string; name: string }[];
  stages: Stage[];
  cards: Card[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [cards, setCards] = useState(initialCards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => setCards(initialCards), [initialCards]);

  const needle = q.trim().toLowerCase();
  const visible = needle
    ? cards.filter((c) => [c.name, c.company, c.city, c.phone, c.rep].some((v) => v?.toLowerCase().includes(needle)))
    : cards;

  // Active stages, plus any inactive one a lead is still in, plus "No stage".
  const used = new Set(cards.map((c) => c.stageId));
  const columns = [
    ...stages.filter((s) => s.isActive || used.has(s.id)),
    ...(used.has(null) ? [{ id: NO_STAGE, name: "No stage", colorHex: "#94a3b8", isActive: true }] : []),
  ];
  const inColumn = (colId: string) => visible.filter((c) => (c.stageId ?? NO_STAGE) === colId);

  async function move(card: Card, toColId: string) {
    const toStageId = toColId === NO_STAGE ? null : toColId;
    if (card.stageId === toStageId) return;
    if (!card.canEdit) { toast.error("You can't change this lead"); return; }
    const before = cards;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stageId: toStageId } : c)));
    const res = await fetch(`/api/account-contacts/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadStageId: toStageId }),
    }).catch(() => null);
    if (!res?.ok) {
      setCards(before);
      const err = await res?.json().catch(() => ({}));
      toast.error(err?.error ?? "Could not move the lead");
      return;
    }
    toast.success(`${card.name} → ${columns.find((c) => c.id === toColId)?.name ?? "stage"}`);
    router.refresh();
  }

  function setParam(key: "view" | "owner", value: string) {
    const params = new URLSearchParams({ view, owner });
    params.set(key, value);
    router.push(`/pipeline?${params.toString()}`);
  }

  const max = Math.max(1, ...columns.map((c) => inColumn(c.id).length));

  return (
    <div className="p-4 sm:p-6">
      <PageHeader large title="Pipeline" description={`${cards.length} lead${cards.length === 1 ? "" : "s"} by sales stage`} />

      <div className="mb-4 flex items-center gap-2 flex-wrap" data-guide="crm-pipeline-controls">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, company, phone…"
          className="input w-full sm:w-64 text-sm"
          data-guide="crm-pipeline-search"
        />
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm" data-guide="crm-pipeline-view">
          {(["kanban", "funnel"] as const).map((v) => (
            <button key={v} onClick={() => setParam("view", v)} className={`px-3 py-1.5 ${view === v ? "bg-court-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              {v === "kanban" ? "Board" : "Funnel"}
            </button>
          ))}
        </div>
        <select value={owner} onChange={(e) => setParam("owner", e.target.value)} className="input w-auto text-sm" data-guide="crm-pipeline-owner">
          <option value="me">My leads</option>
          <option value="all">{reps.length ? "All reps" : "Mine + unassigned"}</option>
          <option value="unassigned">Unassigned</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {view === "funnel" ? (
        <div className="card p-4 space-y-2 max-w-3xl">
          {columns.map((col) => {
            const n = inColumn(col.id).length;
            return (
              <div key={col.id} className="flex items-center gap-3">
                <div className="w-44 shrink-0 text-sm text-slate-700 truncate">{col.name}</div>
                <div className="flex-1 h-6 rounded bg-slate-100 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${(n / max) * 100}%`, background: col.colorHex ?? "#64748b" }} />
                </div>
                <div className="w-10 text-right text-sm font-mono text-slate-700">{n}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" data-guide="crm-pipeline-board">
          {columns.map((col) => (
            <div
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
              onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const card = cards.find((c) => c.id === dragId);
                if (card) move(card, col.id);
                setDragId(null);
              }}
              className={`w-64 shrink-0 rounded-xl border p-2 ${overCol === col.id ? "border-court-400 bg-court-50" : "border-slate-200 bg-slate-50"}`}
            >
              <div className="flex items-center justify-between px-1 pb-2" data-guide="crm-pipeline-stage">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <span className="w-2 h-2 rounded-full" style={{ background: col.colorHex ?? "#64748b" }} />
                  {col.name}
                </span>
                <span className="text-xs font-mono text-slate-500">{inColumn(col.id).length}</span>
              </div>
              <div className="space-y-2 min-h-[40px]">
                {inColumn(col.id).map((c) => (
                  <div
                    key={c.id}
                    draggable={c.canEdit}
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => setDragId(null)}
                    data-guide="crm-pipeline-card"
                    className={`rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-sm ${c.canEdit ? "cursor-grab" : ""} ${dragId === c.id ? "opacity-50" : ""}`}
                  >
                    <Link href={`/crm/contacts/${c.id}`} className="font-medium text-court-700 hover:underline block truncate" data-guide="crm-pipeline-card-open">{c.name}</Link>
                    <div className="text-xs text-slate-500 truncate">
                      {c.company !== c.name ? `${c.company}${c.city ? " · " : ""}` : ""}{c.city ?? ""}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="truncate">{c.rep ?? "Unassigned"}</span>
                      <span className="font-mono shrink-0">{daysSince(c.createdAt)}d</span>
                    </div>
                    {c.canEdit && (
                      <select
                        value={c.stageId ?? NO_STAGE}
                        onChange={(e) => move(c, e.target.value)}
                        aria-label={`Stage for ${c.name}`}
                        className="mt-1.5 w-full text-xs border border-slate-200 rounded px-1.5 py-1 bg-white"
                      >
                        {columns.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
