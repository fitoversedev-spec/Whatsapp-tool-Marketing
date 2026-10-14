import { searchLeads } from "@/lib/agent/read/leads";
import { searchLeadsQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";
import { createLead } from "@/lib/agent/leads/service";
import { createLeadInputSchema } from "@/lib/agent/schemas/leads";

// search_leads: CRM leads (and, with includeContacts, other customers) by name, company or phone.
// Exports GET only so a later stage can add POST (create lead) to this same file.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "search_leads",
  async ({ input }) => {
    const body = await searchLeads(input);
    return { body, recordIds: body.items.map((i) => i.id) };
  },
  { mutating: false, inputSchema: searchLeadsQuerySchema },
);

// create_lead: an unassigned lead from the AI Sales Agent; 409 on a possible duplicate.
export const POST = withAgent("create_lead", createLead, { mutating: true, inputSchema: createLeadInputSchema });
