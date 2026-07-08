"use client";

// List view for saved court-image designs. Drafts and sent designs share
// the same table; sales clicks a thumbnail to re-open the wizard at Step 2
// for editing (only drafts editable — sent designs offer a "Clone" instead).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import CourtImageWizard from "./CourtImageWizard";

type CourtImageRow = {
  id: string;
  number: string;
  customerName: string;
  imageUrl: string | null;
  caption: string | null;
  status: string;
  contactPhone: string | null;
  conversationId: string | null;
  sentAt: string | null;
  createdByName: string;
  createdAt: string;
  sports: string[];
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-emerald-100 text-emerald-800",
};

export default function CourtImagesClient({
  isAdmin,
  initialCourtImages,
}: {
  isAdmin: boolean;
  initialCourtImages: CourtImageRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<CourtImageRow[]>(initialCourtImages);
  const [showWizard, setShowWizard] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (
          !r.customerName.toLowerCase().includes(s) &&
          !r.number.toLowerCase().includes(s) &&
          !(r.contactPhone ?? "").toLowerCase().includes(s)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  function openNew() {
    setEditingId(null);
    setShowWizard(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setShowWizard(true);
  }

  async function reload() {
    const res = await fetch("/api/court-images");
    if (!res.ok) return;
    const data = await res.json();
    setRows(
      (data.courtImages ?? []).map((c: CourtImageRow & { updatedAt?: string }) => ({
        ...c,
      }))
    );
  }

  async function deleteRow(id: string) {
    const row = rows.find((x) => x.id === id);
    const wasSent = row?.status === "sent";
    const message = wasSent
      ? `Delete design ${row?.number}? It was already SENT to ${row?.contactPhone ?? "the customer"} — the record will be permanently removed. This cannot be undone.`
      : "Delete this design? This cannot be undone.";
    if (!confirm(message)) return;
    const res = await fetch(`/api/court-images/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.message ?? e.error ?? "Delete failed");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success("Design deleted");
  }

  async function resend(id: string) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    if (!r.contactPhone) {
      toast.error("No phone on this design — open and edit to add one");
      return;
    }
    if (!confirm(`Re-send design ${r.number} to ${r.contactPhone}?`)) return;
    const res = await fetch(`/api/court-images/${id}/send`, { method: "POST" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.message ?? e.error ?? "Send failed");
      return;
    }
    toast.success("Sent");
    reload();
  }

  return (
    <>
      <PageHeader
        title="Court Designer"
        description="Create editable 2D court layouts and send them to customers on WhatsApp."
        action={
          <button
            onClick={openNew}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
          >
            + New design
          </button>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer, number, phone…"
            className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
          >
            <option value="all">All status</option>
            <option value="draft">Drafts</option>
            <option value="sent">Sent</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <div className="text-4xl mb-3">🎨</div>
            <div className="text-sm font-semibold text-slate-900 mb-1">
              {rows.length === 0 ? "No designs yet" : "No matches"}
            </div>
            <div className="text-xs text-slate-500 mb-4">
              {rows.length === 0
                ? "Build your first court design — multi-sport layouts, draggable everything, sent as a WhatsApp image."
                : "Try different filters."}
            </div>
            {rows.length === 0 && (
              <button
                onClick={openNew}
                className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
              >
                + Build your first design
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((r) => (
              <div
                key={r.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition group"
              >
                <button
                  type="button"
                  onClick={() => openEdit(r.id)}
                  className="block w-full aspect-video bg-slate-100 overflow-hidden"
                >
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.imageUrl}
                      alt={r.customerName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                      No preview
                    </div>
                  )}
                </button>
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-mono text-slate-500">{r.number}</div>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                        STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 leading-tight line-clamp-1">
                    {r.customerName}
                  </div>
                  {r.sports.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.sports.map((s) => (
                        <span
                          key={s}
                          className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded capitalize"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500 leading-snug">
                    {r.contactPhone ?? "No phone"} · {r.createdByName}
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    {r.status === "draft" && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(r.id)}
                          className="flex-1 text-xs text-slate-700 border border-slate-300 hover:border-slate-400 rounded px-2 py-1"
                        >
                          Edit
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => deleteRow(r.id)}
                            className="text-xs text-red-600 hover:bg-red-50 rounded px-2 py-1"
                            title="Delete design (admin only)"
                          >
                            🗑
                          </button>
                        )}
                      </>
                    )}
                    {r.status === "sent" && (
                      <>
                        {r.imageUrl && (
                          <a
                            href={r.imageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 text-xs text-slate-700 border border-slate-300 hover:border-slate-400 rounded px-2 py-1 text-center"
                          >
                            View image
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => resend(r.id)}
                          className="text-xs text-wa-dark hover:bg-wa-green/10 border border-wa-green/30 rounded px-2 py-1"
                          title="Re-send"
                        >
                          ↗ Re-send
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => deleteRow(r.id)}
                            className="text-xs text-red-600 hover:bg-red-50 rounded px-2 py-1"
                            title="Delete sent design (admin only)"
                          >
                            🗑
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CourtImageWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={() => {
          reload();
        }}
        editingId={editingId ?? undefined}
      />
    </>
  );
}
