"use client";

// Search WhatsApp contacts and tick people for a broadcast group — used by the
// Groups tab's "New group" (name + people) and a group page's "Add people".
// Ticks survive new searches, so you can search "Salem", tick everyone, then
// search "Erode" and tick more. "Select all N matching" takes every contact the
// search finds, beyond the 50 shown. Contacts who blocked campaigns can be
// picked (broadcasts skip them); people already in the group can't.

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

type PickerContact = {
  id: string;
  phone: string;
  name: string | null;
  allowCampaign: boolean;
  fields: Record<string, string>;
  tags: { id: string; name: string; color: string }[];
};

type AddResult = { added: number; alreadyIn: number };

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function cityOf(c: PickerContact): string {
  const f = c.fields;
  return String(f["Attribute 1"] ?? f.location ?? f.Location ?? f.city ?? f.City ?? "").trim();
}

export default function ContactPickerDialog({
  mode,
  group,
  existingIds,
  onClose,
  onDone,
}: {
  mode: "create" | "add";
  // The group people are added to (add mode).
  group?: { id: string; name: string };
  // Contacts already in that group — shown as such and not tickable.
  existingIds?: Set<string>;
  onClose: () => void;
  onDone: (group: { id: string; name: string }) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PickerContact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const inGroup = useMemo(() => existingIds ?? new Set<string>(), [existingIds]);

  // Debounced search; replies to an older search are ignored.
  useEffect(() => {
    const seq = ++searchSeq.current;
    setLoading(true);
    const t = setTimeout(() => {
      const q = search.trim();
      fetch(`/api/contacts?page=1${q ? `&search=${encodeURIComponent(q)}` : ""}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (seq !== searchSeq.current) return;
          setResults(d.contacts ?? []);
          setTotal(d.total ?? 0);
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setResults([]);
          setTotal(0);
        })
        .finally(() => {
          if (seq === searchSeq.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const pickable = results.filter((c) => !inGroup.has(c.id));
  const allShownPicked = pickable.length > 0 && pickable.every((c) => picked.has(c.id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShown() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const c of pickable) {
        if (allShownPicked) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const q = search.trim();
      const res = await fetch(`/api/contacts?idsOnly=1${q ? `&search=${encodeURIComponent(q)}` : ""}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setPicked((prev) => {
        const next = new Set(prev);
        for (const id of (d.ids ?? []) as string[]) if (!inGroup.has(id)) next.add(id);
        return next;
      });
    } catch {
      toast.error("Could not select them all — try again");
    } finally {
      setSelectingAll(false);
    }
  }

  const canSubmit = !saving && (mode === "create" ? !!name.trim() : picked.size > 0);

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const contactIds = [...picked];
      const res =
        mode === "create"
          ? await fetch("/api/broadcast-groups", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, contactIds }),
            })
          : await fetch(`/api/broadcast-groups/${group!.id}/members`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contactIds }),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ? String(data.error) : mode === "create" ? "Could not create the group" : "Could not add them");
        return;
      }
      const r: AddResult = data.result ?? { added: 0, alreadyIn: 0 };
      const g: { id: string; name: string } = data.group ?? group!;
      if (mode === "create") {
        toast.success(r.added > 0 ? `Group "${g.name}" created with ${plural(r.added, "person", "people")}` : `Group "${g.name}" created`);
      } else {
        toast.success(
          `Added ${plural(r.added, "person", "people")} to "${g.name}"` + (r.alreadyIn > 0 ? ` · ${r.alreadyIn} already there` : ""),
        );
      }
      onDone(g);
    } catch {
      setError(mode === "create" ? "Could not create the group" : "Could not add them");
    } finally {
      setSaving(false);
    }
  }

  const checkboxCls = "h-4 w-4 rounded border-slate-300 text-court-600 focus:ring-court-500";

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-picker-title"
        data-guide="wa-group-picker"
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="contact-picker-title" className="font-semibold text-slate-900">
          {mode === "create" ? "New group" : `Add people to "${group?.name}"`}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Search your WhatsApp contacts and tick the people you want. Contacts who blocked campaigns can be added —
          broadcasts skip them.
        </p>

        {mode === "create" && (
          <div className="mt-4">
            <label htmlFor="picker-group-name" className="block text-xs font-medium text-slate-600 mb-1">
              Group name
            </label>
            <input
              id="picker-group-name"
              autoFocus
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Salem turf owners"
              className="input text-sm"
            />
          </div>
        )}

        <div className="mt-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone or city (e.g. Salem)"
            aria-label="Search contacts"
            autoFocus={mode === "add"}
            className="input text-sm"
          />
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs flex-wrap min-h-[1.5rem]">
          <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
            <input type="checkbox" checked={allShownPicked} onChange={toggleShown} disabled={pickable.length === 0} className={checkboxCls} />
            Select shown
          </label>
          {total > results.length && !loading && (
            <button
              type="button"
              onClick={() => void selectAllMatching()}
              disabled={selectingAll}
              className="font-medium text-court-600 hover:underline disabled:opacity-50"
            >
              {selectingAll ? "Selecting…" : `Select all ${total} ${search.trim() ? "matching" : "contacts"}`}
            </button>
          )}
          <span className="ml-auto text-slate-500">
            <b className="text-slate-800 font-mono">{picked.size}</b> selected
            {picked.size > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className="ml-2 underline hover:text-slate-800">
                Clear
              </button>
            )}
          </span>
        </div>

        <div className="mt-2 border border-slate-200 rounded-lg overflow-y-auto divide-y divide-slate-100 flex-1 min-h-[10rem]">
          {loading ? (
            <p className="p-4 text-center text-xs text-slate-500">Loading…</p>
          ) : results.length === 0 ? (
            <p className="p-4 text-center text-xs text-slate-500">
              {search.trim() ? "No contacts match. Try another search." : "No WhatsApp contacts yet."}
            </p>
          ) : (
            results.map((c) => {
              const already = inGroup.has(c.id);
              const city = cityOf(c);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 px-3 py-2 ${already ? "opacity-60 cursor-default" : "cursor-pointer hover:bg-slate-50"} ${
                    picked.has(c.id) ? "bg-court-50" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={already || picked.has(c.id)}
                    disabled={already}
                    onChange={() => toggle(c.id)}
                    aria-label={`Select ${c.name ?? c.phone}`}
                    className={checkboxCls}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 truncate">{c.name || "(no name)"}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      +{c.phone}
                      {city && <span className="ml-2 text-slate-400">· {city}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {already && <span className="badge bg-slate-100 text-slate-600">In group</span>}
                    {!already && !c.allowCampaign && <span className="badge bg-amber-100 text-amber-800">Blocked</span>}
                    {c.tags.slice(0, 2).map((t) => (
                      <span
                        key={t.id}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ backgroundColor: `${t.color}22`, color: t.color }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </label>
              );
            })
          )}
        </div>
        {!loading && total > results.length && (
          <p className="mt-1 text-[11px] text-slate-400">
            Showing the first {results.length} of {total}. Search to narrow it down, or use “Select all”.
          </p>
        )}

        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary flex-1">
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="btn btn-primary flex-1">
            {saving
              ? mode === "create"
                ? "Creating…"
                : "Adding…"
              : mode === "create"
                ? picked.size > 0
                  ? `Create with ${plural(picked.size, "person", "people")}`
                  : "Create group"
                : `Add ${plural(picked.size, "person", "people")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
