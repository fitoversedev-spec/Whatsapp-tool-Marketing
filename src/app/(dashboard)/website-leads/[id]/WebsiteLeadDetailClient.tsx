"use client";

import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import type { Rep } from "@/components/meta/MoveToCrmDialog";
import type { MetaLeadLabelChip } from "@/lib/meta-ads/queries";
import type { MetaLeadStageRow } from "@/lib/meta-ads/lead-fields";
import type { WebsiteLeadDetail } from "@/lib/website-leads/list";
import LeadManagement from "../LeadManagement";
import { LeadFacts, useLeadActions } from "../LeadDetailParts";
import { LeadBadges } from "../shared";

// Detail page for one website lead. Two columns: every field the visitor gave
// (including each answer to the form's questions) on the left, and the lead
// management card (stage, rep, labels, notes) on the right. Header actions:
// Add to group, Move to marketing and Move to CRM, plus Remove for admins and
// managers (a removed lead opens with a Restore banner, plus Delete permanently
// for admins, and read-only controls). The same pieces make up the list's side
// panel (LeadDetailParts.tsx, LeadManagement.tsx). Times are shown in IST.

export default function WebsiteLeadDetailClient({
  lead,
  reps,
  labelCatalog,
  stageCatalog,
  currentUserId,
  isAdmin,
  canRemove,
}: {
  lead: WebsiteLeadDetail;
  reps: Rep[];
  labelCatalog: MetaLeadLabelChip[];
  stageCatalog: MetaLeadStageRow[];
  currentUserId: string;
  isAdmin: boolean;
  canRemove: boolean; // admins and managers: Remove button (and they alone can open a removed lead)
}) {
  const router = useRouter();
  const actions = useLeadActions({
    lead,
    reps,
    canRemove,
    isAdmin,
    // A removed or deleted lead is gone: back to the list, which remembers Show removed for this browser session.
    onChanged: (change) => (change === "remove" || change === "delete" ? router.push("/website-leads") : router.refresh()),
  });

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        large
        backHref="/website-leads"
        title={lead.name || "Website lead"}
        description="Every answer from this Build a court form submission."
        action={actions.buttons}
      />

      {actions.banner && <div className="mt-4">{actions.banner}</div>}

      {lead.badges.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">This number is also in:</span>
          <LeadBadges badges={lead.badges} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <LeadFacts lead={lead} />
        <LeadManagement
          lead={lead}
          reps={reps}
          labelCatalog={labelCatalog}
          stageCatalog={stageCatalog}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />
      </div>

      {actions.dialogs}
    </div>
  );
}
