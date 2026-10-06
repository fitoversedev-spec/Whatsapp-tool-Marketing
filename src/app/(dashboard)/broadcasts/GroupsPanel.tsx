"use client";

// The Broadcasts page's "Groups" tab: every broadcast group (shared by the
// whole team) with its size and maker. Open a group to see or remove members;
// "Send" opens the broadcast composer aimed at that group. Renaming and
// deleting are for the group's maker or an admin (the API enforces the same).

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export type GroupRow = {
  id: string;
  name: string;
  memberCount: number;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

export default function GroupsPanel({
  groups: groupsProp,
  currentUserId,
  isAdmin,
  onSend,
}: {
  groups: GroupRow[];
  currentUserId: string;
  isAdmin: boolean;
  onSend: (groupId: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Show a rename or delete straight away; the refresh that follows brings the
  // server's list.
  const [newNames, setNewNames] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const groups = groupsProp
    .filter((g) => !deletedIds.has(g.id))
    .map((g) => (newNames[g.id] ? { ...g, name: newNames[g.id] } : g));

  const canEdit = (g: GroupRow) => isAdmin || g.createdByUserId === currentUserId;

  async function rename(g: GroupRow) {
    const name = renameValue.trim();
    if (!name || name === g.name) {
      setRenamingId(null);
      return;
    }
    setBusyId(g.id);
    try {
      const res = await fetch(`/api/broadcast-groups/${g.id}`, {
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
      setNewNames((m) => ({ ...m, [g.id]: data.group?.name ?? name }));
      setRenamingId(null);
      router.refresh();
    } catch {
      toast.error("Could not rename the group");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(g: GroupRow) {
    if (
      !confirm(
        `Delete the group "${g.name}"? The ${g.memberCount} ${g.memberCount === 1 ? "person stays" : "people stay"} in WhatsApp contacts; only the group is removed.`,
      )
    ) {
      return;
    }
    setBusyId(g.id);
    try {
      const res = await fetch(`/api/broadcast-groups/${g.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ? String(data.error) : "Could not delete the group");
        return;
      }
      toast.success("Group deleted");
      setDeletedIds((s) => new Set(s).add(g.id));
      router.refresh();
    } catch {
      toast.error("Could not delete the group");
    } finally {
      setBusyId(null);
    }
  }

  if (groups.length === 0) {
    return (
      <div className="card p-8 sm:p-12 text-center text-slate-500" data-guide="wa-groups-list">
        No groups yet. On the{" "}
        <Link href="/ad-campaigns" className="text-court-600 font-medium hover:underline">
          Ad campaigns
        </Link>{" "}
        page, tick leads and choose <strong>Add to group</strong>.
      </div>
    );
  }

  function nameCell(g: GroupRow) {
    if (renamingId === g.id) {
      return (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={renameValue}
            maxLength={80}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename(g);
              if (e.key === "Escape") setRenamingId(null);
            }}
            aria-label="New group name"
            className="input text-sm !py-1"
          />
          <button
            type="button"
            onClick={() => void rename(g)}
            disabled={busyId === g.id || !renameValue.trim()}
            className="btn btn-primary !px-2.5 !py-1 !text-xs"
          >
            Save
          </button>
          <button type="button" onClick={() => setRenamingId(null)} className="text-xs text-slate-500 hover:text-slate-800 px-1">
            Cancel
          </button>
        </div>
      );
    }
    return (
      <Link href={`/broadcasts/groups/${g.id}`} className="font-medium text-slate-900 hover:underline">
        {g.name}
      </Link>
    );
  }

  function actions(g: GroupRow) {
    return (
      <div className="flex items-center justify-end gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => onSend(g.id)}
          disabled={g.memberCount === 0}
          title={g.memberCount === 0 ? "This group has no members yet" : "Send a broadcast to this group"}
          className="btn btn-primary !px-2.5 !py-1 !text-xs"
        >
          Send
        </button>
        <Link href={`/broadcasts/groups/${g.id}`} className="btn btn-secondary !px-2.5 !py-1 !text-xs">
          Open
        </Link>
        {canEdit(g) && renamingId !== g.id && (
          <>
            <button
              type="button"
              onClick={() => {
                setRenamingId(g.id);
                setRenameValue(g.name);
              }}
              disabled={busyId === g.id}
              className="btn btn-secondary !px-2.5 !py-1 !text-xs"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => void remove(g)}
              disabled={busyId === g.id}
              className="btn !px-2.5 !py-1 !text-xs bg-white border border-rose-200 text-rose-600 hover:bg-rose-50"
            >
              Delete
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <div className="md:hidden space-y-3" data-guide="wa-groups-list">
        {groups.map((g) => (
          <div key={g.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">{nameCell(g)}</div>
              <span className="shrink-0 text-sm font-mono text-slate-700">{g.memberCount}</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Made by {g.createdByName} · updated {fmtDate(g.updatedAt)}
            </div>
            <div className="mt-3">{actions(g)}</div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block card overflow-hidden" data-guide="wa-groups-list">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Group</th>
                <th className="!text-right">Members</th>
                <th className="text-left">Made by</th>
                <th className="text-left">Updated</th>
                <th className="!text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>{nameCell(g)}</td>
                  <td className="text-right font-mono text-slate-700">{g.memberCount}</td>
                  <td className="text-slate-600">{g.createdByName}</td>
                  <td className="text-slate-500 text-sm">{fmtDate(g.updatedAt)}</td>
                  <td>{actions(g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
