import { moveAdLeadToCrm } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { moveAdLeadInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// move_ad_lead_to_crm: Promotes an ad lead into the CRM, unassigned and de-duplicated by phone.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("move_ad_lead_to_crm", moveAdLeadToCrm, { mutating: true, inputSchema: moveAdLeadInputSchema }),
  { id: "adLeadId" },
);
