import { listDeals } from "@/lib/agent/read/deals";
import { dealsQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// list_deals: confirmed (won) projects, newest first.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "list_deals",
  async ({ input }) => {
    const body = await listDeals(input);
    return { body, recordIds: body.items.map((i) => i.id) };
  },
  { mutating: false, inputSchema: dealsQuerySchema },
);
