import { updateDealWonValue } from "@/lib/agent/deals/dealEdits";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { updateDealWonValueInputSchema } from "@/lib/agent/schemas/deals";
import { withAgent } from "@/lib/agent/withAgent";

// update_deal_won_value: Verdict APPROVAL: withAgent queues a request for a human; this handler runs only when an approval is executed.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const PATCH = withPathIds(
  withAgent("update_deal_won_value", updateDealWonValue, { mutating: true, inputSchema: updateDealWonValueInputSchema }),
  { id: "dealId" },
);
