"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

export type GroupMemberRow = {
  contactId: string;
  name: string | null;
  phone: string;
  city: string | null;
  // ok = will get broadcasts; blocked = campaigns not allowed; opted_out = asked to stop
  status: "ok" | "blocked" | "opted_out";
  addedAt: string;
  addedByName: string | null;
};

const STATUS: Record<GroupMemberRow["status"], { label: string; cls: string }> = {
  ok: { label: "Will receive", cls: "bg-green-100 text-green-800" },
  blocked: { label: "Campaigns blocked", cls: "bg-amber-100 text-amber-800" },
  opted_out: { label: "Opted out", cls: "bg-rose-100 text-rose-700" },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

export default function GroupDetailClient({
  group: groupProp,
  members: membersProp,
  canEdit,
}: {
  group: { id: string; name: string; createdByName: string; createdAt: string };
  members: GroupMemberRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(groupProp.name);
  // Show removals and a rename straight away; the refresh that follows brings
  // the server's copy.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState<string | null>(null);
  const group = newName ? { ...groupProp, name: newName } : groupProp;
  const members = useMemo(() => membersProp.filter((m) => !removedIds.has(m.contactId)), [membersProp, removedIds]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    const digits = q.replace(/\D/g, "");
    return members.filter(
      (m) =>
        (m.name ?? "").toLowerCase().includes(q) ||
        (m.city ?? "").toLowerCase().includes(q) ||
        (digits.length >= 3 && m.phone.includes(digits)),
    );
  }, [members, search]);

  const willReceive = members.filter((m) => m.status === "ok").length;
  const blocked = members.filter((m) => m.status === "blocked").length;
  const optedOut = members.filter((m) => m.status === "opted_out").length;

  const pickedShown = shown.filter((m) => picked.has(m.contactId));
  const allShownPicked = shown.length > 0 && pickedShown.length === shown.length;

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllShown() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allShownPicked) for (const m of shown) next.delete(m.contactId);
      else for (const m of shown) next.add(m.contactId);
      return next;
    });
  }

  async function removePicked() {
    const ids = pickedShown.map((m) => m.contactId);
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} ${ids.length === 1 ? "person" : "people"} from "${group.name}"? They stay in WhatsApp contacts.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/broadcast-groups/${group.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ? String(data.error) : "Could not remove them from the group");
        return;
      }
      toast.success(`Removed ${data.removed ?? ids.length} from the group`);
      setRemovedIds((s) => new Set([...s, ...ids]));
      setPicked(new Set());
      router.refresh();
    } catch {
      toast.error("Could not remove them from the group");
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    const name = renameValue.trim();
    if (!name || name === group.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/broadcast-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ? String(data.error) : "Could not rename the group");
        return;
      }
      toast.success("Group renamed");
      setNewName(data.group?.name ?? name);
      setRenaming(false);
      router.refresh();
    } catch {
      toast.error("Could not rename the group");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    if (!confirm(`Delete the group "${group.name}"? Its people stay in WhatsApp contacts; only the group is removed.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/broadcast-groups/${group.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ? String(data.error) : "Could not delete the group");
        return;
      }
      toast.success("Group deleted");
      router.push("/broadcasts?tab=groups");
      router.refresh();
    } catch {
      toast.error("Could not delete the group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        backHref="/broadcasts?tab=groups"
        title={group.name}
        description={`Broadcast group · ${members.length} ${members.length === 1 ? "person" : "people"} · made by ${group.createdByName} on ${fmtDate(group.createdAt)}`}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {members.length > 0 ? (
              <Link href={`/broadcasts?group=${group.id}`} className="btn btn-primary" data-guide="wa-group-send">
                Send broadcast
              </Link>
            ) : (
              <span className="btn btn-primary opacity-50 cursor-not-allowed" title="This group has no members yet">
                Send broadcast
              </span>
            )}
            {canEdit && !renaming && (
              <>
                <button type="button" onClick={() => setRenaming(true)} disabled={busy} className="btn btn-secondary">
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => void deleteGroup()}
                  disabled={busy}
                  className="btn bg-white border border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  Delete group
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        {renaming && (
          <div className="card p-3 flex items-center gap-2 flex-wrap">
            <label htmlFor="group-rename" className="text-sm font-medium text-slate-700">
              Group name
            </label>
            <input
              id="group-rename"
              autoFocus
              value={renameValue}
              maxLength={80}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="input text-sm flex-1 min-w-[12rem]"
            />
            <button type="button" onClick={() => void rename()} disabled={busy || !renameValue.trim()} className="btn btn-primary">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                setRenameValue(group.name);
              }}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-sm">
          <span className="badge bg-green-100 text-green-800">{willReceive} will receive</span>
          {blocked > 0 && <span className="badge bg-amber-100 text-amber-800">{blocked} campaigns blocked</span>}
          {optedOut > 0 && <span className="badge bg-rose-100 text-rose-700">{optedOut} opted out</span>}
        </div>

        {members.length === 0 ? (
          <div className="card p-8 text-center text-slate-500">
            Nobody in this group yet. On the{" "}
            <Link href="/ad-campaigns" className="text-court-600 font-medium hover:underline">
              Ad campaigns
            </Link>{" "}
            page, tick leads and choose <strong>Add to group</strong>.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone or city"
                aria-label="Search members"
                className="input text-sm w-full sm:w-72"
              />
              <span className="text-xs text-slate-500">
                Showing <b className="text-slate-800 font-mono">{shown.length}</b> of{" "}
                <span className="font-mono">{members.length}</span>
              </span>
              {canEdit && pickedShown.length > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm text-slate-600">{pickedShown.length} selected</span>
                  <button
                    type="button"
                    onClick={() => void removePicked()}
                    disabled={busy}
                    className="btn bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 !py-1.5"
                  >
                    Remove from group
                  </button>
                </div>
              )}
            </div>
            {!canEdit && (
              <p className="text-xs text-slate-500">
                Only the person who made this group ({group.createdByName}) or an admin can remove people from it.
              </p>
            )}

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      {canEdit && (
                        <th className="w-8 !pr-0">
                          <input
                            type="checkbox"
                            checked={allShownPicked}
                            onChange={toggleAllShown}
                            aria-label="Select everyone shown"
                            className="h-4 w-4 rounded border-slate-300 text-court-600 focus:ring-court-500"
                          />
                        </th>
                      )}
                      <th className="text-left">Name</th>
                      <th className="text-left">Phone</th>
                      <th className="text-left">City</th>
                      <th className="text-left">Status</th>
                      <th className="text-left">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((m) => (
                      <tr key={m.contactId} className={picked.has(m.contactId) ? "bg-court-50" : undefined}>
                        {canEdit && (
                          <td className="w-8 !pr-0">
                            <input
                              type="checkbox"
                              checked={picked.has(m.contactId)}
                              onChange={() => togglePick(m.contactId)}
                              aria-label={`Select ${m.name ?? m.phone}`}
                              className="h-4 w-4 rounded border-slate-300 text-court-600 focus:ring-court-500"
                            />
                          </td>
                        )}
                        <td className="font-medium text-slate-900 whitespace-nowrap">{m.name ?? "—"}</td>
                        <td className="font-mono text-slate-700 whitespace-nowrap">+{m.phone}</td>
                        <td className="text-slate-600">{m.city ?? "—"}</td>
                        <td>
                          <span className={`badge ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>
                        </td>
                        <td className="text-xs text-slate-500 whitespace-nowrap">
                          {fmtDate(m.addedAt)}
                          {m.addedByName ? ` · ${m.addedByName}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
