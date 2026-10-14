import { estimatePrice } from "@/lib/agent/read/pricing";
import { estimateBodySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// estimate_price: read-only. Prices a plot from the rate sheet; the caller can never pass a rate.
// Nothing is saved, so it is not mutating and needs no Idempotency-Key.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withAgent(
  "estimate_price",
  async ({ input }) => ({ body: await estimatePrice(input) }),
  { mutating: false, inputSchema: estimateBodySchema },
);
