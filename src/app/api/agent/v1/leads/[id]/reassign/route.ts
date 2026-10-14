import { reassignLead } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { reassignLeadInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// reassign_lead: Verdict APPROVAL: moves an owned lead to another rep once a human approves.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("reassign_lead", reassignLead, { mutating: true, inputSchema: reassignLeadInputSchema }),
  { id: "leadId" },
);
