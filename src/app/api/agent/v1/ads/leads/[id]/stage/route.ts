import { setAdLeadStage } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { setAdLeadStageInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// set_ad_lead_stage: Sets the stage of a captured Meta ad lead.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("set_ad_lead_stage", setAdLeadStage, { mutating: true, inputSchema: setAdLeadStageInputSchema }),
  { id: "adLeadId" },
);
