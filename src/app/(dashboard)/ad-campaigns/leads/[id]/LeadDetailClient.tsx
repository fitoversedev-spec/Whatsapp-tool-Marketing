"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import MoveToCrmDialog, { type Rep } from "@/components/meta/MoveToCrmDialog";
import { parseFieldData } from "@/lib/meta-ads/field-data";
import type { MetaLeadRow } from "@/lib/meta-ads/queries";

// Dedicated detail page for one captured lead — replaces the old inline
// row-expand in LeadsTable. Renders the structured fields plus EVERY raw
// field_data answer as a label|value table, with the two promote actions:
// "Move to CRM" (owner-picker dialog, only when not already in the CRM) and the
// one-click "Move to WhatsApp marketing" (upserts the phone into the marketing
// Contact list — no owner picker).
export default function LeadDetailClient({ lead, reps }: { lead: MetaLeadRow; reps: Rep[] }) {
  const router = useRouter();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const [sendingToMarketing, setSendingToMarketing] = useState(false);

  const fields = parseFieldData(lead.fieldData);

  async function moveToMarketing() {
    setSendingToMarketing(true);
    try {
      const res = await fetch(`/api/ad-campaigns/leads/${lead.id}/move-to-marketing`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ? String(err.error) : "Could not add this lead to WhatsApp marketing");
        return;
      }
      toast.success("Lead added to WhatsApp marketing");
    } catch {
      toast.error("Could not add this lead to WhatsApp marketing");
    } finally {
      setSendingToMarketing(false);
    }
  }

  // Structured fields first, then every parsed form answer below.
  const rows: { label: string; value: string }[] = [
    { label: "Name", value: lead.fullName ?? "—" },
    { label: "Phone", value: lead.phone ?? "—" },
    { label: "Email", value: lead.email ?? "—" },
    { label: "City", value: lead.city ?? "—" },
    { label: "Sport", value: lead.sport ?? "—" },
    { label: "Form", value: lead.formName ?? "—" },
    { label: "Campaign", value: lead.campaignName ?? "—" },
    { label: "Captured", value: new Date(lead.capturedAt).toLocaleString("en-IN") },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <PageHeader
        large
        backHref="/ad-campaigns"
        title={lead.fullName ?? "Lead"}
        description="Every field captured from this Instant-Form submission."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={moveToMarketing}
              disabled={sendingToMarketing}
              title="Add this lead's phone to the WhatsApp marketing contact list"
              className="btn btn-secondary !px-3 !py-1.5"
            >
              {sendingToMarketing ? "Adding…" : "→ WhatsApp marketing"}
            </button>
            {lead.inCrm ? (
              <span className="badge bg-green-100 text-green-700">In CRM ✓</span>
            ) : (
              <button
                type="button"
                onClick={() => setMoving(true)}
                className="btn btn-primary !px-3 !py-1.5"
              >
                Move to CRM
              </button>
            )}
          </div>
        }
      />

      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => {
              const mono = r.label === "Phone" || r.label === "Captured";
              return (
                <tr key={r.label} className="border-b border-slate-100 last:border-0">
                  <th className="text-left align-top px-3 py-2 w-40 text-xs font-heading font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                    {r.label}
                  </th>
                  <td className={`px-3 py-2 text-slate-800 break-words ${mono ? "font-mono" : ""}`}>{r.value}</td>
                </tr>
              );
            })}
            {fields.length > 0 && (
              <tr className="bg-slate-50/60 border-b border-slate-100">
                <td colSpan={2} className="px-3 py-1.5 text-[11px] font-heading font-bold uppercase tracking-wide text-slate-400">
                  Form answers
                </td>
              </tr>
            )}
            {fields.map((f, i) => (
              <tr key={`f-${i}`} className="border-b border-slate-100 last:border-0">
                <th className="text-left align-top px-3 py-2 w-40 text-xs font-semibold capitalize text-slate-500 whitespace-nowrap">
                  {f.name.replace(/_/g, " ")}
                </th>
                <td className="px-3 py-2 text-slate-800 break-words">{f.value || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {moving && (
        <MoveToCrmDialog
          lead={lead}
          reps={reps}
          onClose={() => setMoving(false)}
          onDone={() => {
            setMoving(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
