import { getPipeline } from "@/lib/agent/read/deals";
import { pipelineQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// get_pipeline: lead counts per stage, plus the lead rows (optionally one stage).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_pipeline",
  async ({ input }) => {
    const body = await getPipeline(input);
    return { body, recordIds: body.leads.map((l) => l.id) };
  },
  { mutating: false, inputSchema: pipelineQuerySchema },
);
