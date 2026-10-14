import { getLeadTimeline } from "@/lib/agent/read/leads";
import { leadTimelineQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// get_lead_timeline: what has happened with this customer, newest first, minus anything private to a rep.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_lead_timeline",
  async ({ input, params }) => {
    const body = await getLeadTimeline(params.id, input);
    return { body, recordIds: params.id ? [params.id] : [] };
  },
  { mutating: false, inputSchema: leadTimelineQuerySchema },
);
