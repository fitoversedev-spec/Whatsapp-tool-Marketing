import { moveToCrm } from "@/lib/agent/website/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { moveWebsiteLeadInputSchema } from "@/lib/agent/schemas/website";
import { withAgent } from "@/lib/agent/withAgent";

// move_website_lead_to_crm: promotes a website lead into the CRM, unassigned and de-duplicated by phone.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("move_website_lead_to_crm", moveToCrm, { mutating: true, inputSchema: moveWebsiteLeadInputSchema }),
  { id: "websiteLeadId" },
);
