import { getWebsiteLead } from "@/lib/agent/website/read";
import { withAgent } from "@/lib/agent/withAgent";

// get_website_lead: one website lead with its form answers, badges and notes.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_website_lead",
  async ({ params }) => {
    const body = await getWebsiteLead(params.id);
    return { body, recordIds: [body.id] };
  },
  { mutating: false },
);
