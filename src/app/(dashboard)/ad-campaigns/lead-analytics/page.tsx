import { requireUser } from "@/lib/auth";
import { leadsByCity, sportByCity, repeatLeads, jobAnalytics, areaAnalytics, b2bB2cAnalytics, salesSportAnalytics, salesTimelineAnalytics, salesCustomFieldAnalytics, campaignSummaryInRange, topCampaignPerDimension, salesTopCampaignPerDimension } from "@/lib/meta-ads/leadAnalytics";
import LeadAnalyticsClient from "./LeadAnalyticsClient";

// Open to all approved reps — requireUser redirects a logged-out visitor who
// reaches the URL directly. The date range is driven by the
// ?from/?to search params, the same convention as the Ad Campaigns page and the
// CRM analytics routes: blank picker => all-time (2000-01-01..now); a picked
// range narrows to exactly that window, with the upper bound pushed to
// end-of-day so the "to" day is fully included. The client's DateRangePicker
// re-runs this server fetch by pushing a new query string (no API route needed).

function parseDateParam(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export default async function LeadAnalyticsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireUser();

  const from = parseDateParam(searchParams.from, new Date("2000-01-01T00:00:00Z"));
  // Guard the upper bound against a malformed ?to= (an Invalid Date would throw
  // RangeError when Prisma serializes the `lte` filter and 500 the page).
  const to = ((): Date => {
    if (!searchParams.to) return new Date();
    const d = new Date(searchParams.to + "T23:59:59");
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  const [byCity, sportCity, repeats, jobs, areas, b2bB2c, salesSports, salesTimelines, salesCustom, campaigns, topCampaigns, salesTopCampaigns] = await Promise.all([
    leadsByCity({ from, to }),
    sportByCity({ from, to }),
    repeatLeads({ from, to }),
    jobAnalytics({ from, to }),
    areaAnalytics({ from, to }),
    b2bB2cAnalytics({ from, to }),
    salesSportAnalytics({ from, to }),
    salesTimelineAnalytics({ from, to }),
    salesCustomFieldAnalytics({ from, to }),
    campaignSummaryInRange({ from, to }),
    topCampaignPerDimension({ from, to }),
    salesTopCampaignPerDimension({ from, to }),
  ]);

  const hasDateFilter = !!searchParams.from || !!searchParams.to;

  return (
    <LeadAnalyticsClient
      byCity={byCity}
      sportByCity={sportCity}
      repeats={repeats}
      jobs={jobs}
      areas={areas}
      b2bB2c={b2bB2c}
      salesSports={salesSports}
      salesTimelines={salesTimelines}
      salesCustom={salesCustom}
      campaigns={campaigns}
      topCampaigns={topCampaigns}
      salesTopCampaigns={salesTopCampaigns}
      hasDateFilter={hasDateFilter}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
