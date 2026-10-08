import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isManagerOrAbove } from "@/lib/rbac";
import { getCampaignById, getAssignableReps, getAdLeadBreakdown, getMetaLeadLabels, getMetaLeadStages } from "@/lib/meta-ads/queries";
import { getInitialLeadList, parseLeadRange } from "@/lib/meta-ads/lead-list";
import CampaignDetailClient from "./CampaignDetailClient";

// Detail view for one Meta ad campaign, addressed by its RAW Meta campaign id:
// params.campaignId === MetaCampaign.metaId — the id MetaLead rows join on
// (NEVER the internal MetaCampaign.id). Open to all approved reps; requireUser
// redirects a logged-out visitor who reaches the URL directly.
//
// Same ?from/?to convention as the CRM analytics rep drill-down and the Ad
// Campaigns list (see parseLeadRange): a blank picker means all-time
// (2000-01-01..now); a picked range narrows to exactly that window, with the
// upper bound pushed to end-of-day. Both ends are guarded against a malformed
// param. ?tab=analytics opens the Campaign analytics tab; anything else opens
// Campaign leads.

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: { campaignId: string };
  searchParams: { from?: string; to?: string; tab?: string };
}) {
  const user = await requireUser();

  const range = parseLeadRange(searchParams.from, searchParams.to);

  const [detail, initialLeads, reps, adBreakdown, labelCatalog, stageCatalog] = await Promise.all([
    getCampaignById(params.campaignId, range),
    getInitialLeadList({ ...range, campaignId: params.campaignId }),
    getAssignableReps(),
    getAdLeadBreakdown(params.campaignId, range),
    getMetaLeadLabels(),
    getMetaLeadStages(),
  ]);

  if (!detail) notFound();

  return (
    <CampaignDetailClient
      detail={detail}
      initialLeads={initialLeads}
      reps={reps}
      adBreakdown={adBreakdown}
      labelCatalog={labelCatalog}
      stageCatalog={stageCatalog}
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      canBulkAssign={isManagerOrAbove(user.role)}
      initialTab={searchParams.tab === "analytics" ? "analytics" : "leads"}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
