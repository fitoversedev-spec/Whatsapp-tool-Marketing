import { requireAdmin } from "@/lib/auth";
import { leadsByCity, sportByCity, repeatLeads } from "@/lib/meta-ads/leadAnalytics";
import LeadAnalyticsClient from "./LeadAnalyticsClient";

// Admin-only (the All Tools entry is adminOnly) — requireAdmin redirects a
// non-admin who reaches the URL directly. The date range is driven by the
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
  await requireAdmin();

  const from = parseDateParam(searchParams.from, new Date("2000-01-01T00:00:00Z"));
  // Guard the upper bound against a malformed ?to= (an Invalid Date would throw
  // RangeError when Prisma serializes the `lte` filter and 500 the page).
  const to = ((): Date => {
    if (!searchParams.to) return new Date();
    const d = new Date(searchParams.to + "T23:59:59");
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  const [byCity, sportCity, repeats] = await Promise.all([
    leadsByCity({ from, to }),
    sportByCity({ from, to }),
    repeatLeads({ from, to }),
  ]);

  return (
    <LeadAnalyticsClient
      byCity={byCity}
      sportByCity={sportCity}
      repeats={repeats}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
