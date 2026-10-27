import { setStage } from "@/lib/agent/website/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { setWebsiteLeadStageInputSchema } from "@/lib/agent/schemas/website";
import { withAgent } from "@/lib/agent/withAgent";

// set_website_lead_stage: sets the stage of a website lead (same stage list as ad leads).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("set_website_lead_stage", setStage, { mutating: true, inputSchema: setWebsiteLeadStageInputSchema }),
  { id: "websiteLeadId" },
);
