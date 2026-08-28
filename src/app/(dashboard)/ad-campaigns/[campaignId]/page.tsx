import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCampaignById, getLeadsForCampaign, getAssignableReps, getAdLeadBreakdown, getMetaLeadLabels } from "@/lib/meta-ads/queries";
import CampaignDetailClient from "./CampaignDetailClient";

// Detail view for one Meta ad campaign, addressed by its RAW Meta campaign id:
// params.campaignId === MetaCampaign.metaId — the id MetaLead rows join on
// (NEVER the internal MetaCampaign.id). Open to all approved reps; requireUser
// redirects a logged-out visitor who reaches the URL directly.
//
// Same ?from/?to convention as the CRM analytics rep drill-down and the Ad
// Campaigns list: a blank picker means all-time (2000-01-01..now); a picked
// range narrows to exactly that window, with the upper bound pushed to
// end-of-day so the "to" day is fully included. Both ends are guarded against a
// malformed param (an Invalid Date would throw when Prisma serializes the
// filter and 500 the page).

function parseFrom(raw: string | undefined): Date {
  const fallback = new Date("2000-01-01T00:00:00Z");
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function parseTo(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw + "T23:59:59");
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: { campaignId: string };
  searchParams: { from?: string; to?: string };
}) {
  const user = await requireUser();

  const range = { from: parseFrom(searchParams.from), to: parseTo(searchParams.to) };

  const [detail, leads, reps, adBreakdown, labelCatalog] = await Promise.all([
    getCampaignById(params.campaignId, range),
    getLeadsForCampaign(params.campaignId, range),
    getAssignableReps(),
    getAdLeadBreakdown(params.campaignId, range),
    getMetaLeadLabels(),
  ]);

  if (!detail) notFound();

  return (
    <CampaignDetailClient
      detail={detail}
      leads={leads}
      reps={reps}
      adBreakdown={adBreakdown}
      labelCatalog={labelCatalog}
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
