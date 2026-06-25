"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { TAG_COLORS, TAG_COLOR_CLASSES } from "@/lib/tags";

type Tag = {
  id: string;
  name: string;
  color: string;
  contactCount: number;
  createdAt: string;
};

export default function TagsClient({
  isAdmin,
  initialTags,
}: {
  isAdmin: boolean;
  initialTags: Tag[];
}) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("slate");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("slate");
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create");
        return;
      }
      setTags((curr) => [...curr, data.tag].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setColor("slate");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const res = await fetch(`/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), color: editColor }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save");
      return;
    }
    setTags((curr) =>
      curr
        .map((t) => (t.id === id ? { ...t, name: data.tag.name, color: data.tag.color } : t))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditingId(null);
  }

  async function remove(id: string, name: string, count: number) {
    const msg =
      count > 0
        ? `Delete "${name}"? It will be removed from ${count} contact${count === 1 ? "" : "s"}.`
        : `Delete "${name}"?`;
    if (!confirm(msg)) return;
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTags((curr) => curr.filter((t) => t.id !== id));
    }
  }

  return (
    <>
      <PageHeader
        title="Tags"
        description={`${tags.length} ${tags.length === 1 ? "tag" : "tags"} · Apply tags to organize contacts`}
        action={
          isAdmin && (
            <button
              onClick={() => setCreating(true)}
              className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg transition text-sm"
            >
              + New tag
            </button>
          )
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {creating && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
            <div className="font-semibold text-slate-900 mb-3 text-sm">New tag</div>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. VIP, School, Hot lead"
                autoFocus
                className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
              />
              <ColorChooser value={color} onChange={setColor} />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCreating(false);
                    setName("");
                    setError(null);
                  }}
                  className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={create}
                  disabled={!name.trim() || busy}
                  className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-md text-sm disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {tags.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <div className="text-4xl mb-2">🏷️</div>
            <h3 className="font-semibold text-slate-900">No tags yet</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Tags help you organize contacts by type (VIP, School, Hot lead) and filter broadcasts to the right audience.
            </p>
            {isAdmin && !creating && (
              <button
                onClick={() => setCreating(true)}
                className="mt-4 inline-block px-4 py-2 text-sm bg-wa-green text-white rounded-md hover:bg-wa-dark"
              >
                Create your first tag
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {tags.map((tag) => {
                const c = TAG_COLOR_CLASSES[tag.color] ?? TAG_COLOR_CLASSES.slate;
                const isEditing = editingId === tag.id;
                return (
                  <li key={tag.id} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                    {isEditing ? (
                      <>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          className="flex-1 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                        />
                        <ColorChooser value={editColor} onChange={setEditColor} size="sm" />
                        <button
                          onClick={() => saveEdit(tag.id)}
                          className="px-3 py-1.5 text-xs font-medium bg-wa-green text-white rounded"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs text-slate-600 hover:text-slate-900 px-2"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}
                        >
                          {tag.name}
                        </span>
                        <Link
                          href={`/contacts?tag=${tag.id}`}
                          className="text-xs text-slate-500 hover:text-slate-900"
                        >
                          {tag.contactCount} {tag.contactCount === 1 ? "contact" : "contacts"}
                        </Link>
                        <div className="flex-1" />
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => {
                                setEditingId(tag.id);
                                setEditName(tag.name);
                                setEditColor(tag.color);
                              }}
                              className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1 hover:bg-slate-100 rounded"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => remove(tag.id, tag.name, tag.contactCount)}
                              className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function ColorChooser({
  value,
  onChange,
  size = "md",
}: {
  value: string;
  onChange: (c: string) => void;
  size?: "sm" | "md";
}) {
  const dotSize = size === "sm" ? "w-5 h-5" : "w-7 h-7";
  return (
    <div className="flex items-center gap-1.5">
      {TAG_COLORS.map((c) => {
        const cls = TAG_COLOR_CLASSES[c];
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            aria-label={`Color ${c}`}
            className={`${dotSize} rounded-full ${cls.dot} transition ${
              active ? "ring-2 ring-offset-1 ring-slate-900" : "opacity-60 hover:opacity-100"
            }`}
          />
        );
      })}
    </div>
  );
}
