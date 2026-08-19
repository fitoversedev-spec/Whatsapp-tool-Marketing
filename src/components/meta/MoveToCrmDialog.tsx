"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import type { MetaLeadRow } from "@/lib/meta-ads/queries";

export type Rep = { id: string; name: string };

// Pick an owner (rep) and move a captured lead into the CRM. POSTs to the
// move route which creates the Account + AccountContact and back-links
// MetaLead.accountContactId; on success the caller refreshes so the row
// re-renders as "In CRM ✓". Shared by the Ad Campaigns list and the campaign
// detail leads table.
export default function MoveToCrmDialog({
  lead,
  reps,
  onClose,
  onDone,
}: {
  lead: MetaLeadRow;
  reps: Rep[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  // Default to unassigned — an owner is optional.
  const [ownerUserId, setOwnerUserId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/ad-campaigns/leads/${lead.id}/move-to-crm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Empty = don't assign a specific rep; the route defaults the owner to
        // the current user when ownerUserId is omitted.
        body: JSON.stringify(ownerUserId ? { ownerUserId } : {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ? String(err.error) : "Could not move this lead to the CRM");
        return;
      }
      toast.success("Lead moved to the CRM");
      onDone();
    } catch {
      toast.error("Could not move this lead to the CRM");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-slate-900">Move to CRM</h2>
        <p className="text-xs text-slate-500 mt-1">
          Creates a CRM contact from{" "}
          {lead.fullName ? <span className="font-medium text-slate-700">{lead.fullName}</span> : "this lead"}
          {lead.phone ? ` (${lead.phone})` : ""}. Assign it to a sales rep, or leave it unassigned.
        </p>

        <label className="block text-xs font-medium text-slate-600 mt-4 mb-1">Assign to</label>
        <select
          value={ownerUserId}
          onChange={(e) => setOwnerUserId(e.target.value)}
          className="input text-sm"
        >
          <option value="">Don&apos;t assign (unassigned)</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="btn btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="btn btn-primary flex-1"
          >
            {saving ? "Moving…" : "Move to CRM"}
          </button>
        </div>
      </div>
    </div>
  );
}
