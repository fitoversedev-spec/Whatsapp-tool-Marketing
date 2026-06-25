"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import PageHeader from "@/components/PageHeader";
import { colorFor, daysSince, type PipelineStage } from "@/lib/pipeline";

type Card = {
  id: string;
  contactPhone: string;
  contactName: string | null;
  pipelineStage: string;
  stageChangedAt: string | null;
  dealValue: string | null;
  expectedCloseAt: string | null;
  lostReason: string | null;
  assignedToName: string | null;
  assignedToUserId: string | null;
  lastMessage: { body: string; direction: string; createdAt: string } | null;
  createdAt: string;
};

type CloseoutPrompt = {
  cardId: string;
  toStage: string;
  type: "won" | "lost";
};

export default function PipelineClient({
  currentUser,
  initialStages,
  initialCards,
  salesUsers,
  view,
  owner,
}: {
  currentUser: { id: string; name: string; role: "admin" | "sales" };
  initialStages: PipelineStage[];
  initialCards: Card[];
  salesUsers: { id: string; name: string }[];
  view: "kanban" | "funnel";
  owner: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [stages] = useState(initialStages);
  const [cards, setCards] = useState(initialCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [closeout, setCloseout] = useState<CloseoutPrompt | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.push(`/pipeline?${next.toString()}`);
  }

  const filteredCards = useMemo(() => {
    if (!search.trim()) return cards;
    const q = search.toLowerCase();
    return cards.filter(
      (c) =>
        (c.contactName ?? "").toLowerCase().includes(q) ||
        c.contactPhone.includes(q) ||
        (c.lastMessage?.body ?? "").toLowerCase().includes(q)
    );
  }, [cards, search]);

  // Fallback stage for cards whose pipelineStage was deleted from the
  // configured stages list. Prefer "new" if present, else the first stage,
  // else the literal id "new" (guaranteed to keep the card visible even if
  // stages is empty — defensive but should never happen in practice).
  const fallbackStageId = useMemo(
    () => stages.find((s) => s.id === "new")?.id ?? stages[0]?.id ?? "new",
    [stages]
  );

  const cardsByStage = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const s of stages) map.set(s.id, []);
    if (!map.has(fallbackStageId)) map.set(fallbackStageId, []);
    for (const c of filteredCards) {
      const arr = map.get(c.pipelineStage) ?? map.get(fallbackStageId)!;
      arr.push(c);
    }
    return map;
  }, [filteredCards, stages, fallbackStageId]);

  const totalsByStage = useMemo(() => {
    const m = new Map<string, { count: number; value: number }>();
    for (const s of stages) m.set(s.id, { count: 0, value: 0 });
    if (!m.has(fallbackStageId)) m.set(fallbackStageId, { count: 0, value: 0 });
    for (const c of filteredCards) {
      const t = m.get(c.pipelineStage) ?? m.get(fallbackStageId)!;
      t.count += 1;
      t.value += c.dealValue ? Number(c.dealValue) : 0;
    }
    return m;
  }, [filteredCards, stages, fallbackStageId]);

  const activeCard = activeId ? cards.find((c) => c.id === activeId) : null;

  async function moveCard(
    cardId: string,
    toStage: string,
    extras?: { dealValue?: number; lostReason?: string; expectedCloseAt?: string }
  ) {
    const prev = cards;
    setCards((curr) =>
      curr.map((c) =>
        c.id === cardId
          ? {
              ...c,
              pipelineStage: toStage,
              stageChangedAt: new Date().toISOString(),
              ...(extras?.dealValue !== undefined && { dealValue: String(extras.dealValue) }),
              ...(extras?.lostReason !== undefined && { lostReason: extras.lostReason }),
              ...(extras?.expectedCloseAt !== undefined && { expectedCloseAt: extras.expectedCloseAt }),
            }
          : c
      )
    );
    try {
      const res = await fetch(`/api/conversations/${cardId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStage, ...extras }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
    } catch (err) {
      setCards(prev);
      setErrorMsg(err instanceof Error ? err.message : "Move failed");
      setTimeout(() => setErrorMsg(null), 4000);
    }
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const cardId = String(e.active.id);
    const over = e.over?.id ? String(e.over.id) : null;
    if (!over) return;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.pipelineStage === over) return;
    const targetStage = stages.find((s) => s.id === over);
    if (!targetStage) return;
    if (targetStage.type === "won" || targetStage.type === "lost") {
      setCloseout({ cardId, toStage: over, type: targetStage.type });
      return;
    }
    moveCard(cardId, over);
  }

  return (
    <>
      <PageHeader
        title="Sales pipeline"
        description={`${filteredCards.length} leads · ${formatINR(
          filteredCards.reduce((s, c) => s + (c.dealValue ? Number(c.dealValue) : 0), 0)
        )} total value`}
        action={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <ViewToggle value={view} onChange={(v) => setParam("view", v)} />
          </div>
        }
      />

      {/* Filters bar */}
      <div className="px-4 sm:px-6 lg:px-8 py-3 bg-white border-b border-slate-200 flex items-center gap-3 flex-wrap">
        <input
          placeholder="Search name, phone, or message…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] max-w-md text-sm px-3 py-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
        />
        <OwnerSelect
          value={owner}
          onChange={(v) => setParam("owner", v)}
          salesUsers={salesUsers}
          currentUser={currentUser}
        />
      </div>

      {errorMsg && (
        <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="p-4 sm:p-6 lg:p-8">
        {view === "kanban" ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <div className="flex gap-4 overflow-x-auto pb-4">
              {stages.map((s) => (
                <KanbanColumn
                  key={s.id}
                  stage={s}
                  cards={cardsByStage.get(s.id) ?? []}
                  totals={totalsByStage.get(s.id) ?? { count: 0, value: 0 }}
                />
              ))}
            </div>
            <DragOverlay>
              {activeCard ? <DraggableCard card={activeCard} dragging /> : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <FunnelView stages={stages} totals={totalsByStage} />
        )}
      </div>

      {closeout && (
        <CloseoutModal
          prompt={closeout}
          card={cards.find((c) => c.id === closeout.cardId)!}
          onCancel={() => setCloseout(null)}
          onSubmit={async (extras) => {
            await moveCard(closeout.cardId, closeout.toStage, extras);
            setCloseout(null);
          }}
        />
      )}
    </>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
      <button
        onClick={() => onChange("kanban")}
        className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
          value === "kanban" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
        }`}
      >
        🗂️ Kanban
      </button>
      <button
        onClick={() => onChange("funnel")}
        className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
          value === "funnel" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
        }`}
      >
        🔻 Funnel
      </button>
    </div>
  );
}

function OwnerSelect({
  value,
  onChange,
  salesUsers,
  currentUser,
}: {
  value: string;
  onChange: (v: string) => void;
  salesUsers: { id: string; name: string }[];
  currentUser: { id: string; name: string; role: "admin" | "sales" };
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm px-3 py-1.5 border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
    >
      {currentUser.role === "admin" && <option value="all">All owners</option>}
      <option value="me">Mine</option>
      <option value="unassigned">Unassigned</option>
      {currentUser.role === "admin" &&
        salesUsers
          .filter((u) => u.id !== currentUser.id)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
    </select>
  );
}

function KanbanColumn({
  stage,
  cards,
  totals,
}: {
  stage: PipelineStage;
  cards: Card[];
  totals: { count: number; value: number };
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const c = colorFor(stage.color);
  return (
    <div className="shrink-0 w-72 sm:w-80">
      <div
        className={`rounded-xl border-2 border-dashed transition ${
          isOver ? `${c.ring} ring-2 ring-offset-1 ${c.soft}` : "border-slate-200"
        }`}
      >
        <div className={`px-3 py-2.5 rounded-t-xl ${c.bg} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
            <span className={`text-sm font-semibold ${c.text}`}>{stage.label}</span>
          </div>
          <div className={`text-xs ${c.text}`}>
            {totals.count} · {formatINRShort(totals.value)}
          </div>
        </div>
        <div ref={setNodeRef} className="p-2 space-y-2 min-h-[200px]">
          {cards.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-400">
              Drag cards here
            </div>
          )}
          {cards.map((card) => (
            <DraggableCard key={card.id} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DraggableCard({ card, dragging = false }: { card: Card; dragging?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: card.id,
  });
  const days = card.stageChangedAt ? daysSince(new Date(card.stageChangedAt)) : 0;
  const daysColor =
    days < 7 ? "text-emerald-600" : days < 30 ? "text-amber-600" : "text-red-600";
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-white rounded-lg border border-slate-200 p-3 shadow-sm cursor-grab active:cursor-grabbing select-none ${
        isDragging && !dragging ? "opacity-30" : ""
      } ${dragging ? "shadow-lg ring-2 ring-wa-green/40" : "hover:border-slate-300 hover:shadow"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm text-slate-900 truncate">
            {card.contactName || card.contactPhone}
          </div>
          <div className="text-xs text-slate-500 truncate">{card.contactPhone}</div>
        </div>
        {card.dealValue && (
          <div className="text-xs font-semibold text-slate-700 shrink-0">
            {formatINRShort(Number(card.dealValue))}
          </div>
        )}
      </div>
      {card.lastMessage?.body && (
        <div className="mt-2 text-xs text-slate-600 line-clamp-2">
          {card.lastMessage.direction === "outbound" ? "→ " : "← "}
          {card.lastMessage.body}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span className={daysColor}>{days}d in stage</span>
        <div className="flex items-center gap-2">
          {card.assignedToName && (
            <span className="text-slate-500 truncate max-w-[80px]">
              👤 {card.assignedToName}
            </span>
          )}
          <Link
            href={`/inbox?conversation=${card.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-wa-dark hover:underline"
          >
            Open →
          </Link>
        </div>
      </div>
    </div>
  );
}

function FunnelView({
  stages,
  totals,
}: {
  stages: PipelineStage[];
  totals: Map<string, { count: number; value: number }>;
}) {
  const active = stages.filter((s) => s.type === "active");
  const won = stages.filter((s) => s.type === "won");
  const lost = stages.filter((s) => s.type === "lost");

  const maxCount = Math.max(
    1,
    ...active.map((s) => totals.get(s.id)?.count ?? 0),
    ...won.map((s) => totals.get(s.id)?.count ?? 0)
  );

  // Conversion: ratio of stage N count to stage 0 count
  const top = totals.get(active[0]?.id ?? "")?.count ?? 0;

  const wonTotal = won.reduce((s, st) => s + (totals.get(st.id)?.count ?? 0), 0);
  const lostTotal = lost.reduce((s, st) => s + (totals.get(st.id)?.count ?? 0), 0);
  const wonValue = won.reduce((s, st) => s + (totals.get(st.id)?.value ?? 0), 0);

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-xs text-emerald-700 uppercase tracking-wide font-medium">Won</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{wonTotal}</div>
          <div className="text-xs text-emerald-600">{formatINR(wonValue)}</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="text-xs text-red-700 uppercase tracking-wide font-medium">Lost</div>
          <div className="text-2xl font-bold text-red-700 mt-1">{lostTotal}</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="text-xs text-blue-700 uppercase tracking-wide font-medium">Win rate</div>
          <div className="text-2xl font-bold text-blue-700 mt-1">
            {wonTotal + lostTotal > 0
              ? `${Math.round((wonTotal / (wonTotal + lostTotal)) * 100)}%`
              : "—"}
          </div>
        </div>
      </div>

      {active.map((s, idx) => {
        const stageData = totals.get(s.id) ?? { count: 0, value: 0 };
        const c = colorFor(s.color);
        const widthPct =
          maxCount > 0 ? Math.max(8, (stageData.count / maxCount) * 100) : 8;
        const conv = top > 0 ? (stageData.count / top) * 100 : 0;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <div className="w-32 text-right shrink-0">
              <div className="text-sm font-medium text-slate-900">{s.label}</div>
              <div className="text-xs text-slate-500">{stageData.count} · {formatINRShort(stageData.value)}</div>
            </div>
            <div className="flex-1">
              <div
                className={`h-12 rounded-r-md flex items-center justify-end px-3 transition-all ${c.bg}`}
                style={{ width: `${widthPct}%` }}
              >
                <span className={`text-xs font-semibold ${c.text}`}>{stageData.count}</span>
              </div>
            </div>
            <div className="w-16 text-xs text-slate-500 shrink-0">
              {idx > 0 && top > 0 && `${Math.round(conv)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CloseoutModal({
  prompt,
  card,
  onCancel,
  onSubmit,
}: {
  prompt: CloseoutPrompt;
  card: Card;
  onCancel: () => void;
  onSubmit: (extras: { dealValue?: number; lostReason?: string }) => Promise<void>;
}) {
  const [dealValue, setDealValue] = useState(card.dealValue ?? "");
  const [lostReason, setLostReason] = useState(card.lostReason ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handle() {
    if (prompt.type === "won" && (!dealValue || Number(dealValue) <= 0)) return;
    if (prompt.type === "lost" && !lostReason.trim()) return;
    setSubmitting(true);
    await onSubmit({
      ...(prompt.type === "won" && { dealValue: Number(dealValue) }),
      ...(prompt.type === "lost" && { lostReason: lostReason.trim() }),
    });
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-1">
          {prompt.type === "won" ? "🎉 Mark as Won" : "❌ Mark as Lost"}
        </h3>
        <p className="text-sm text-slate-500 mb-4">
          {card.contactName || card.contactPhone}
        </p>
        {prompt.type === "won" ? (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Deal value (₹)
            </label>
            <input
              type="number"
              autoFocus
              min={0}
              value={dealValue}
              onChange={(e) => setDealValue(e.target.value)}
              placeholder="e.g. 500000"
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Reason for losing
            </label>
            <textarea
              autoFocus
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              rows={3}
              placeholder="Budget too high, went with competitor, no longer needed..."
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green resize-none"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            onClick={handle}
            disabled={
              submitting ||
              (prompt.type === "won" && (!dealValue || Number(dealValue) <= 0)) ||
              (prompt.type === "lost" && !lostReason.trim())
            }
            className={`px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 ${
              prompt.type === "won" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {submitting ? "Saving…" : prompt.type === "won" ? "Mark Won" : "Mark Lost"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatINR(amount: number): string {
  if (amount === 0) return "₹0";
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatINRShort(amount: number): string {
  if (amount === 0) return "—";
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(0)}k`;
  return `₹${Math.round(amount)}`;
}
