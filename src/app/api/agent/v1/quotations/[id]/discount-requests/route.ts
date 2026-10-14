import { withPathIds } from "@/lib/agent/leads/pathIds";
import { requestDiscountHandler } from "@/lib/agent/quotes/approval";
import { requestDiscountInputSchema } from "@/lib/agent/schemas/quotes";
import { withAgent } from "@/lib/agent/withAgent";

// request_discount: Verdict APPROVAL. withAgent queues the request for a person (202); a discount is applied
// only by the approved request's executor (a new approved revision with just the approved rates).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("request_discount", requestDiscountHandler, { mutating: true, inputSchema: requestDiscountInputSchema }),
  { id: "quotationId" },
);
