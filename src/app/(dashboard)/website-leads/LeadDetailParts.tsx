"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useToast } from "@/components/Toast";
import MoveToCrmDialog, { type Rep } from "@/components/meta/MoveToCrmDialog";
import AddToGroupDialog from "@/components/meta/AddToGroupDialog";
import { fmtDateTimeIST } from "@/lib/time";
import type { WebsiteLeadDetail, WebsiteLeadRow } from "@/lib/website-leads/list";
import { CameFromChip, RemoveLeadsDialog, RemovedLeadBanner, courtSizeText, type RemoveAction } from "./shared";

// The pieces of a website lead's detail that the full page and the list's side
// panel both render: what the visitor gave (LeadFacts) and the lead's actions
// (useLeadActions). The Lead management card is LeadManagement.tsx.

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");

// What the visitor gave, with each answer to the form's questions. `compact` is the
// side panel's shorter list (no name, which is in its header, and no technical
// fields; it adds Came from).
export function LeadFacts({ lead, compact = false }: { lead: WebsiteLeadDetail; compact?: boolean }) {
  const rows: { label: string; value: ReactNode; mono?: boolean; only?: "page" | "panel" }[] = [
    { label: "Name", value: dash(lead.name), only: "page" },
    { label: "Phone", value: dash(lead.phone), mono: true },
    { label: "Email", value: dash(lead.email) },
    { label: "City", value: dash(lead.city) },
    { label: "State", value: dash(lead.state) },
    { label: "Job title", value: dash(lead.jobTitle), only: "page" },
    { label: "Sport", value: dash(lead.sport) },
    {
      label: "Court size (L × W)",
      value: lead.lengthFt != null && lead.widthFt != null ? (courtSizeText(lead) ?? "—") : "—",
    },
    { label: "Area", value: lead.areaSqft != null ? `${lead.areaSqft.toLocaleString("en-IN")} sq ft` : "—" },
    { label: "Start time", value: dash(lead.startWhen) },
    { label: "Came from", value: <CameFromChip cameFrom={lead.cameFrom} group={lead.cameFromGroup} />, only: "panel" },
    { label: "Page", value: dash(lead.surface), only: "page" },
    { label: "Environment", value: dash(lead.env), only: "page" },
    { label: "Source", value: dash(lead.source), only: "page" },
    { label: "Received (IST)", value: fmtDateTimeIST(lead.receivedAt), mono: true },
    { label: "Customer's message", value: dash(lead.notes), only: "page" },
  ];
  const shown = rows.filter((r) => r.only !== (compact ? "page" : "panel"));
  const labelW = compact ? "w-28" : "w-40 whitespace-nowrap";
  // The narrow panel must break a long email or URL anywhere; `break-words` would
  // still widen the table cell and give the card a sideways scrollbar.
  const wrap = compact ? "[overflow-wrap:anywhere]" : "break-words";

  return (
    <div className="overflow-x-auto card">
      <table className="w-full text-sm">
        <tbody>
          {shown.map((r) => (
            <tr key={r.label} className="border-b border-slate-100 last:border-0">
              <th className={`text-left align-top px-3 py-2 ${labelW} text-xs font-heading font-bold uppercase tracking-wide text-slate-500`}>
                {r.label}
              </th>
              <td className={`px-3 py-2 text-slate-800 ${wrap} whitespace-pre-wrap ${r.mono ? "font-mono" : ""}`}>
                {r.value}
              </td>
            </tr>
          ))}
          {lead.answers.length > 0 && (
            <tr className="bg-slate-50 border-b border-slate-100">
              <td colSpan={2} className="px-3 py-1.5 text-[11px] font-heading font-bold uppercase tracking-wide text-slate-400">
                Form answers
              </td>
            </tr>
          )}
          {lead.answers.map((a, i) => (
            <tr key={`${a.key}-${i}`} className="border-b border-slate-100 last:border-0">
              <th className={`text-left align-top px-3 py-2 ${compact ? "w-28" : "w-40"} text-xs font-semibold text-slate-500`}>
                {a.label || a.key}
              </th>
              <td className={`px-3 py-2 text-slate-800 ${wrap} whitespace-pre-wrap`}>{dash(a.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// What happened to the lead, for the caller to follow up on (the page leaves or
// refreshes; the panel updates its row). "refresh" = the lead changed under us.
export type LeadChange = RemoveAction | "crm" | "marketing" | "refresh";

// A lead's actions: Add to group, Move to marketing, Move to CRM, Remove (admins and
// managers) and, on a removed lead, the Restore / Delete permanently banner (Delete
// for admins). Returns the pieces for the caller to place: the `buttons` row, the
// `banner` (null unless removed) and the `dialogs` (render them once). A removed
// lead can only be restored or deleted; the other actions are off.
export function useLeadActions({
  lead,
  reps,
  canRemove,
  isAdmin,
  onChanged,
}: {
  lead: Pick<WebsiteLeadRow, "id" | "name" | "phone" | "inCrm" | "inMarketing" | "removedAt">;
  reps: Rep[];
  canRemove: boolean; // admins and managers
  isAdmin: boolean;
  onChanged: (change: LeadChange) => void;
}): { buttons: ReactNode; banner: ReactNode; dialogs: ReactNode } {
  const toast = useToast();
  const base = `/api/website-leads/${lead.id}`;
  const removed = lead.removedAt != null;
  const [movingToCrm, setMovingToCrm] = useState(false);
  // The shared Move to CRM dialog has no keyboard close of its own: Escape closes it here
  // (the side panel ignores that Escape because the dialog is wrapped in role="dialog").
  useEffect(() => {
    if (!movingToCrm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMovingToCrm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [movingToCrm]);
  const [groupOpen, setGroupOpen] = useState(false);
  const [sendingToMarketing, setSendingToMarketing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeAction, setRemoveAction] = useState<RemoveAction | null>(null);
  const removeBusy = removeAction !== null;

  async function changeRemoved(action: RemoveAction) {
    setRemoveAction(action);
    try {
      const res = await fetch("/api/website-leads/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [lead.id], action }),
      });
      const data = await res.json().catch(() => ({}));
      // A delete that removed nothing (the lead was restored meanwhile) is a failure here.
      if (!res.ok || (action === "delete" && !data.changed)) {
        toast.error(`Could not ${action} this lead`);
        if (res.ok) {
          setConfirmDelete(false);
          onChanged("refresh");
        }
        return;
      }
      setConfirmRemove(false);
      setConfirmDelete(false);
      toast.success(
        action === "delete" ? "Deleted 1 lead permanently" : action === "remove" ? "Removed 1 lead" : "Restored 1 lead",
      );
      onChanged(action);
    } catch {
      toast.error(`Could not ${action} this lead`);
    } finally {
      setRemoveAction(null);
    }
  }

  async function moveToMarketing() {
    setSendingToMarketing(true);
    try {
      const res = await fetch(`${base}/move-to-marketing`, { method: "POST" });
      if (!res.ok) {
        toast.error(
          res.status === 422
            ? "This lead has no phone number to add to WhatsApp marketing"
            : "Could not add this lead to WhatsApp marketing",
        );
        return;
      }
      toast.success("Lead added to WhatsApp marketing");
      onChanged("marketing");
    } catch {
      toast.error("Could not add this lead to WhatsApp marketing");
    } finally {
      setSendingToMarketing(false);
    }
  }

  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setGroupOpen(true)} disabled={removed} className="btn btn-secondary !px-3 !py-1.5">
        Add to group
      </button>
      {lead.inMarketing ? (
        <span className="badge bg-green-100 text-green-700">In WhatsApp marketing ✓</span>
      ) : (
        <button
          type="button"
          onClick={() => void moveToMarketing()}
          disabled={sendingToMarketing || removed}
          title="Add this lead's phone to the WhatsApp marketing contact list"
          className="btn btn-secondary !px-3 !py-1.5"
        >
          {sendingToMarketing ? "Adding…" : "Move to marketing"}
        </button>
      )}
      {lead.inCrm ? (
        <span className="badge bg-green-100 text-green-700">In CRM ✓</span>
      ) : (
        <button type="button" onClick={() => setMovingToCrm(true)} disabled={removed} className="btn btn-primary !px-3 !py-1.5">
          Move to CRM
        </button>
      )}
      {canRemove && !removed && (
        <button type="button" onClick={() => setConfirmRemove(true)} className="btn btn-danger !px-3 !py-1.5">
          Remove
        </button>
      )}
    </div>
  );

  const banner = removed ? (
    <RemovedLeadBanner
      removedAt={lead.removedAt!}
      busy={removeAction}
      onRestore={() => void changeRemoved("restore")}
      onDelete={isAdmin ? () => setConfirmDelete(true) : undefined}
    />
  ) : null;

  const dialogs = (
    <>
      {confirmRemove && (
        <RemoveLeadsDialog
          title="Remove this lead?"
          busy={removeBusy}
          onConfirm={() => void changeRemoved("remove")}
          onCancel={() => setConfirmRemove(false)}
        />
      )}

      {confirmDelete && (
        <RemoveLeadsDialog
          permanent
          title="Delete this lead permanently?"
          busy={removeBusy}
          onConfirm={() => void changeRemoved("delete")}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* MoveToCrmDialog has no role of its own; the side panel's Escape key skips
          the panel while a role="dialog" is open (closing it would drop the result). */}
      {movingToCrm && (
        <div role="dialog" aria-modal="true" aria-label="Move to CRM">
          <MoveToCrmDialog
            lead={{ id: lead.id, fullName: lead.name, phone: lead.phone }}
            reps={reps}
            endpoint={`${base}/move-to-crm`}
            onClose={() => setMovingToCrm(false)}
            onDone={() => {
              setMovingToCrm(false);
              onChanged("crm");
            }}
          />
        </div>
      )}

      {groupOpen && (
        <AddToGroupDialog
          websiteLeadIds={[lead.id]}
          onClose={() => setGroupOpen(false)}
          onDone={() => setGroupOpen(false)}
        />
      )}
    </>
  );

  return { buttons, banner, dialogs };
}
