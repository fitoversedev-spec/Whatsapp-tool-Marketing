import { getAnalytics, parseReport } from "@/lib/agent/read/analytics";
import { analyticsQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// get_analytics: company-wide aggregates only. No per-rep figures.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_analytics",
  async ({ input, params }) => ({ body: await getAnalytics(parseReport(params.report), input) }),
  { mutating: false, inputSchema: analyticsQuerySchema },
);
