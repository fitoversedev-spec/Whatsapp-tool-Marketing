import { requireUser } from "@/lib/auth";
import { isManagerOrAbove } from "@/lib/rbac";
import {
  getAdCampaignOverview,
  getCampaignList,
  getAssignableReps,
  getMetaLeadLabels,
  getMetaLeadStages,
} from "@/lib/meta-ads/queries";
import { getInitialLeadList, parseLeadRange } from "@/lib/meta-ads/lead-list";
import AdCampaignsClient from "./AdCampaignsClient";

// Open to all approved reps (ad-campaign data is not rep-scoped) — requireUser
// redirects a logged-out visitor who reaches the URL directly. The date range is driven by the
// ?from/?to search params so the client's DateRangePicker can re-run this
// server fetch by pushing a new query string (no dedicated API route needed).

// Same param convention as the CRM analytics routes (see parseLeadRange): blank
// picker => all-time (2000-01-01..now); a picked range narrows to exactly that
// window, with the upper bound pushed to end-of-day so the "to" day is fully
// included. The lead table then pages itself through /api/ad-campaigns/leads.

export default async function AdCampaignsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const user = await requireUser();

  const { from, to } = parseLeadRange(searchParams.from, searchParams.to);

  const hasDateFilter = !!searchParams.from || !!searchParams.to;
  const [overview, initialLeads, campaigns, reps, labelCatalog, stageCatalog] = await Promise.all([
    getAdCampaignOverview({ from, to }),
    getInitialLeadList({ from, to }),
    getCampaignList(hasDateFilter ? { from, to } : undefined),
    getAssignableReps(),
    getMetaLeadLabels(),
    getMetaLeadStages(),
  ]);

  return (
    <AdCampaignsClient
      overview={overview}
      initialLeads={initialLeads}
      campaigns={campaigns}
      reps={reps}
      labelCatalog={labelCatalog}
      stageCatalog={stageCatalog}
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      canBulkAssign={isManagerOrAbove(user.role)}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
