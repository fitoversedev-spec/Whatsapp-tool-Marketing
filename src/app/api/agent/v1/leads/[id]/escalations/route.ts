import { escalateLead } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { escalateLeadInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// escalate_lead: Hands a lead to a human with a high-priority follow-up and a push.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("escalate_lead", escalateLead, { mutating: true, inputSchema: escalateLeadInputSchema }),
  { id: "leadId" },
);
