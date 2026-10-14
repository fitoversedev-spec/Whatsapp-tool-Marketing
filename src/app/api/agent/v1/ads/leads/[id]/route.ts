import { getAdLead } from "@/lib/agent/read/adLeads";
import { withAgent } from "@/lib/agent/withAgent";

// get_ad_lead: one Meta lead with its form answers, notes and reminders.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_ad_lead",
  async ({ params }) => {
    const body = await getAdLead(params.id);
    return { body, recordIds: [body.id] };
  },
  { mutating: false },
);
