import { listWebsiteLeads } from "@/lib/agent/website/read";
import { websiteLeadsQuerySchema } from "@/lib/agent/schemas/website";
import { withAgent } from "@/lib/agent/withAgent";

// list_website_leads: website (fitoverse.com) enquiries, 20 per page by default. No export.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "list_website_leads",
  async ({ input }) => {
    const body = await listWebsiteLeads(input);
    return { body, recordIds: body.items.map((i) => i.id) };
  },
  { mutating: false, inputSchema: websiteLeadsQuerySchema },
);
