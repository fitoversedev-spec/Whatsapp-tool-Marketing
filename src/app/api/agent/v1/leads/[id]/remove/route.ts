import { removeFromLeads } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { removeFromLeadsInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// remove_from_leads: Verdict APPROVAL: takes a lead off the Leads list (nothing is deleted) once a human approves.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("remove_from_leads", removeFromLeads, { mutating: true, inputSchema: removeFromLeadsInputSchema }),
  { id: "leadId" },
);
