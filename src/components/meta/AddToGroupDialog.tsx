"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";

type GroupOption = { id: string; name: string; memberCount: number };
type AddResult = { added: number; alreadyIn: number; noPhone: number };

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Added 10 to "X" · 1 already there · 2 without a phone number" */
function resultMessage(groupName: string, r: AddResult): string {
  const parts = [`Added ${plural(r.added, "person", "people")} to "${groupName}"`];
  if (r.alreadyIn > 0) parts.push(`${r.alreadyIn} already there`);
  if (r.noPhone > 0) parts.push(`${plural(r.noPhone, "lead", "leads")} without a phone number skipped`);
  return parts.join(" · ");
}

// Put the ticked ad leads into a broadcast group — an existing one or a new
// one named here. Each lead's phone goes into WhatsApp contacts (same as the
// row's "→ WhatsApp" button) and joins the group; leads without a phone are
// skipped. Groups are listed and sent to from the Broadcasts page.
export default function AddToGroupDialog({
  leadIds,
  onClose,
  onDone,
}: {
  leadIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/broadcast-groups")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return;
        const list: GroupOption[] = (d.groups ?? []).map((g: GroupOption) => ({
          id: g.id,
          name: g.name,
          memberCount: g.memberCount,
        }));
        setGroups(list);
        // No groups yet → start on "New group".
        if (list.length === 0) setMode("new");
      })
      .catch(() => {
        if (!cancelled) {
          setGroups([]);
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
  }, [groups, search]);

  const canSubmit = !saving && (mode === "existing" ? !!groupId : !!newName.trim());

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res =
        mode === "existing"
          ? await fetch(`/api/broadcast-groups/${groupId}/members`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ metaLeadIds: leadIds }),
            })
          : await fetch("/api/broadcast-groups", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: newName, metaLeadIds: leadIds }),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Name taken → offer the existing group instead.
        if (res.status === 409 && data.group?.id) {
          setMode("existing");
          setSearch("");
          setGroupId(data.group.id);
        }
        setError(data.error ? String(data.error) : "Could not add the leads to the group");
        return;
      }
      const r: AddResult = data.result ?? { added: 0, alreadyIn: 0, noPhone: 0 };
      const name: string = data.group?.name ?? "the group";
      if (r.added === 0 && r.alreadyIn === 0) toast.error(resultMessage(name, r));
      else toast.success(resultMessage(name, r));
      onDone();
    } catch {
      setError("Could not add the leads to the group");
    } finally {
      setSaving(false);
    }
  }

  const tabCls = (on: boolean) =>
    `px-3 py-1.5 rounded font-medium transition ${on ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-group-title"
        data-guide="wa-add-to-group"
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-to-group-title" className="font-semibold text-slate-900">
          Add {plural(leadIds.length, "lead", "leads")} to a group
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Groups are lists you can send a broadcast to from the{" "}
          <Link href="/broadcasts?tab=groups" className="text-court-600 hover:underline">
            Broadcasts
          </Link>{" "}
          page. The leads are added to your WhatsApp contacts; leads without a phone number are skipped.
        </p>

        <div className="mt-4 inline-flex bg-slate-100 rounded-md p-0.5 text-xs">
          <button type="button" onClick={() => { setMode("existing"); setError(null); }} className={tabCls(mode === "existing")}>
            Existing group
          </button>
          <button type="button" onClick={() => { setMode("new"); setError(null); }} className={tabCls(mode === "new")}>
            New group
          </button>
        </div>

        {mode === "existing" ? (
          <div className="mt-3">
            {groups === null ? (
              <p className="text-sm text-slate-400 py-4 text-center">Loading groups…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                {loadFailed ? "Could not load groups." : "No groups yet."}{" "}
                <button type="button" onClick={() => setMode("new")} className="text-court-600 font-medium hover:underline">
                  Create one
                </button>
              </p>
            ) : (
              <>
                {groups.length > 6 && (
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search groups"
                    aria-label="Search groups"
                    className="input text-sm mb-2"
                  />
                )}
                <div className="border border-slate-200 rounded-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
                  {shown.length === 0 && <p className="p-3 text-xs text-slate-500 text-center">No group matches.</p>}
                  {shown.map((g) => (
                    <label
                      key={g.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${groupId === g.id ? "bg-court-50" : "hover:bg-slate-50"}`}
                    >
                      <input
                        type="radio"
                        name="broadcast-group"
                        checked={groupId === g.id}
                        onChange={() => setGroupId(g.id)}
                        className="text-court-600 focus:ring-court-500"
                      />
                      <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{g.name}</span>
                      <span className="text-xs text-slate-400 font-mono shrink-0">{g.memberCount}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mt-3">
            <label htmlFor="new-group-name" className="block text-xs font-medium text-slate-600 mb-1">
              Group name
            </label>
            <input
              id="new-group-name"
              autoFocus
              value={newName}
              maxLength={80}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="e.g. Football Sep leads"
              className="input text-sm"
            />
          </div>
        )}

        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary flex-1">
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="btn btn-primary flex-1">
            {saving ? "Adding…" : mode === "new" ? "Create and add" : "Add to group"}
          </button>
        </div>
      </div>
    </div>
  );
}
