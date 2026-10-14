import { listAdLeads } from "@/lib/agent/read/adLeads";
import { adLeadsQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// list_ad_leads: Meta lead-form leads, 20 per page by default. No export.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "list_ad_leads",
  async ({ input }) => {
    const body = await listAdLeads(input);
    return { body, recordIds: body.items.map((i) => i.id) };
  },
  { mutating: false, inputSchema: adLeadsQuerySchema },
);
