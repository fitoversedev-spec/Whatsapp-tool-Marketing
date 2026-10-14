import { setLeadStage } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { setLeadStageInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// set_lead_stage: Moves a lead to any active lead stage.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("set_lead_stage", setLeadStage, { mutating: true, inputSchema: setLeadStageInputSchema }),
  { id: "leadId" },
);
