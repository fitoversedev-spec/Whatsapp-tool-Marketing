import { assignUnassignedLead } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { assignLeadInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// assign_unassigned_lead: Assigns a lead nobody owns yet; an owned lead is a 409.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("assign_unassigned_lead", assignUnassignedLead, { mutating: true, inputSchema: assignLeadInputSchema }),
  { id: "leadId" },
);
