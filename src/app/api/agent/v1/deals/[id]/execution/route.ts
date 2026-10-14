import { setDealExecutionStatus } from "@/lib/agent/deals/dealEdits";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { setDealExecutionStatusInputSchema } from "@/lib/agent/schemas/deals";
import { withAgent } from "@/lib/agent/withAgent";

// set_deal_execution_status: Verdict APPROVAL: withAgent queues a request for a human; this handler runs only when an approval is executed.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const PATCH = withPathIds(
  withAgent("set_deal_execution_status", setDealExecutionStatus, {
    mutating: true,
    inputSchema: setDealExecutionStatusInputSchema,
  }),
  { id: "dealId" },
);
