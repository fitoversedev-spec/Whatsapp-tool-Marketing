import { requireAdmin } from "@/lib/auth";
import {
  getAdCampaignOverview,
  getMetaLeads,
  getCampaignList,
  getAssignableReps,
} from "@/lib/meta-ads/queries";
import AdCampaignsClient from "./AdCampaignsClient";

// Admin-only (the All Tools entry is adminOnly) — requireAdmin redirects a
// non-admin who reaches the URL directly. The date range is driven by the
// ?from/?to search params so the client's DateRangePicker can re-run this
// server fetch by pushing a new query string (no dedicated API route needed).

// Same param convention as the CRM analytics routes: blank picker => all-time
// (2000-01-01..now); a picked range narrows to exactly that window, with the
// upper bound pushed to end-of-day so the "to" day is fully included.
function parseDateParam(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export default async function AdCampaignsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const from = parseDateParam(searchParams.from, new Date("2000-01-01T00:00:00Z"));
  // Guard the upper bound against a malformed ?to= (an Invalid Date would throw
  // RangeError when Prisma serializes the `lte` filter and 500 the page).
  const to = ((): Date => {
    if (!searchParams.to) return new Date();
    const d = new Date(searchParams.to + "T23:59:59");
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  // getCampaignList() is a lifetime roster (NOT windowed) and getAssignableReps()
  // is static, so both are fetched alongside the windowed overview/leads.
  const [overview, leads, campaigns, reps] = await Promise.all([
    getAdCampaignOverview({ from, to }),
    getMetaLeads({ from, to }),
    getCampaignList(),
    getAssignableReps(),
  ]);

  return (
    <AdCampaignsClient
      overview={overview}
      leads={leads}
      campaigns={campaigns}
      reps={reps}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
