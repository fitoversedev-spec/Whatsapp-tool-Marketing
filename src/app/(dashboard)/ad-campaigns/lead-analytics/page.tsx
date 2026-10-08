import { requireUser } from "@/lib/auth";
import { getLeadAnalytics } from "@/lib/meta-ads/leadAnalytics";
import { parseLeadRange } from "@/lib/meta-ads/lead-list";
import LeadAnalyticsClient from "./LeadAnalyticsClient";

// Open to all approved reps — requireUser redirects a logged-out visitor who
// reaches the URL directly. The date range is driven by the
// ?from/?to search params, the same convention as the Ad Campaigns page and the
// CRM analytics routes (see parseLeadRange): blank picker => all-time
// (2000-01-01..now); a picked range narrows to exactly that window, with the
// upper bound pushed to end-of-day so the "to" day is fully included. The client's DateRangePicker
// re-runs this server fetch by pushing a new query string (no API route needed).

export default async function LeadAnalyticsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireUser();

  const { from, to } = parseLeadRange(searchParams.from, searchParams.to);
  const a = await getLeadAnalytics({ from, to });

  const hasDateFilter = !!searchParams.from || !!searchParams.to;

  return (
    <LeadAnalyticsClient
      byCity={a.byCity}
      sportByCity={a.sportByCity}
      repeats={a.repeats}
      jobs={a.jobs}
      areas={a.areas}
      b2bB2c={a.b2bB2c}
      salesSports={a.salesSports}
      salesTimelines={a.salesTimelines}
      salesCustom={a.salesCustom}
      campaigns={a.campaigns}
      topCampaigns={a.topCampaigns}
      salesTopCampaigns={a.salesTopCampaigns}
      hasDateFilter={hasDateFilter}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
