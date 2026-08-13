import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCampaignById, getLeadsForCampaign } from "@/lib/meta-ads/queries";
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
  await requireUser();

  const range = { from: parseFrom(searchParams.from), to: parseTo(searchParams.to) };

  // The captured-lead list keys off params.campaignId (the raw Meta id), known
  // before any query, so it rides in the same parallel batch as the detail
  // rollup. On a 404 the wasted lead query is harmless (it just returns []).
  const [detail, leads] = await Promise.all([
    getCampaignById(params.campaignId, range),
    getLeadsForCampaign(params.campaignId, range),
  ]);

  if (!detail) notFound();

  return (
    <CampaignDetailClient
      detail={detail}
      leads={leads}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
