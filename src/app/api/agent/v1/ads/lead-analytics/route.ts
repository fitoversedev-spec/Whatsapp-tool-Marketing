import { getAdLeadAnalytics } from "@/lib/agent/read/adLeads";
import { adLeadAnalyticsQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// get_ad_lead_analytics: Meta lead counts by city, sport, area, job and campaign for a date window.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_ad_lead_analytics",
  async ({ input }) => ({ body: await getAdLeadAnalytics(input) }),
  { mutating: false, inputSchema: adLeadAnalyticsQuerySchema },
);
