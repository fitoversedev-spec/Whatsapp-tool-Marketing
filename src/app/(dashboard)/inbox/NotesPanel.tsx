"use client";

import { useEffect, useState } from "react";

type Note = {
  id: string;
  body: string;
  pinned: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
};

export default function NotesPanel({
  conversationId,
  currentUser,
  open,
  onClose,
}: {
  conversationId: string;
  currentUser: { id: string; role: "admin" | "sales" };
  open: boolean;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [pinnedDraft, setPinnedDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/conversations/${conversationId}/notes`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setNotes(data.notes);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  async function addNote() {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim(), pinned: pinnedDraft }),
      });
      if (res.ok) {
        const data = await res.json();
        setNotes((curr) => [data.note, ...curr].sort(sortNotes));
        setDraft("");
        setPinnedDraft(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(id: string) {
    if (!confirm("Delete this note? This cannot be undone.")) return;
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (res.ok) {
      setNotes((curr) => curr.filter((n) => n.id !== id));
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !pinned }),
    });
    if (res.ok) {
      const data = await res.json();
      setNotes((curr) => curr.map((n) => (n.id === id ? data.note : n)).sort(sortNotes));
    }
  }

  async function saveEdit(id: string) {
    if (!editingBody.trim()) return;
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editingBody.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setNotes((curr) => curr.map((n) => (n.id === id ? data.note : n)).sort(sortNotes));
      setEditingId(null);
      setEditingBody("");
    }
  }

  function canEdit(n: Note): boolean {
    return n.authorId === currentUser.id || currentUser.role === "admin";
  }

  if (!open) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="lg:hidden fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`
          fixed lg:relative inset-y-0 right-0 z-50 lg:z-auto
          w-full sm:w-96 lg:w-80 xl:w-96 lg:shrink-0 h-full
          bg-white border-l border-slate-200 flex flex-col
          shadow-2xl lg:shadow-none
        `}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">📝 Notes</h3>
            <p className="text-xs text-slate-500">
              {notes.length} {notes.length === 1 ? "note" : "notes"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close notes"
            className="p-1.5 rounded-md hover:bg-slate-100"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Add note */}
        <div className="p-3 border-b border-slate-200 bg-slate-50">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add a note about this conversation…"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green resize-none bg-white"
          />
          <div className="flex items-center justify-between mt-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={pinnedDraft}
                onChange={(e) => setPinnedDraft(e.target.checked)}
                className="rounded"
              />
              📌 Pin
            </label>
            <button
              onClick={addNote}
              disabled={!draft.trim() || saving}
              className="px-3 py-1.5 text-xs font-medium bg-wa-green text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-wa-dark transition"
            >
              {saving ? "Saving…" : "Add note"}
            </button>
          </div>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center text-xs text-slate-500 py-8">Loading notes…</div>
          ) : notes.length === 0 ? (
            <div className="text-center text-xs text-slate-500 py-8">
              No notes yet. Add the first one above.
            </div>
          ) : (
            notes.map((n) => (
              <div
                key={n.id}
                className={`rounded-lg border p-3 ${
                  n.pinned ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"
                }`}
              >
                {editingId === n.id ? (
                  <>
                    <textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      rows={3}
                      className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 resize-none"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditingBody("");
                        }}
                        className="text-xs text-slate-600 hover:text-slate-900"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(n.id)}
                        className="text-xs font-medium text-wa-dark hover:underline"
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
                      {n.body}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 text-[10px] text-slate-500">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {n.pinned && <span title="Pinned">📌</span>}
                        <span className="font-medium truncate">{n.authorName}</span>
                        <span>·</span>
                        <span title={new Date(n.createdAt).toLocaleString("en-IN")}>
                          {relativeTime(n.createdAt)}
                        </span>
                        {n.editedAt && <span className="italic">(edited)</span>}
                      </div>
                      {canEdit(n) && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => togglePin(n.id, n.pinned)}
                            className="hover:text-slate-900"
                            title={n.pinned ? "Unpin" : "Pin"}
                          >
                            {n.pinned ? "📌" : "📍"}
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(n.id);
                              setEditingBody(n.body);
                            }}
                            className="hover:text-slate-900"
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => deleteNote(n.id)}
                            className="hover:text-red-600"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

function sortNotes(a: Note, b: Note): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
