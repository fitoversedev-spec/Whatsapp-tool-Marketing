import { setRequirements } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { setRequirementsInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// set_requirements: Merges the lead's requirements into AccountContact.fields under agent.* keys.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const PUT = withPathIds(
  withAgent("set_requirements", setRequirements, { mutating: true, inputSchema: setRequirementsInputSchema }),
  { id: "leadId" },
);
