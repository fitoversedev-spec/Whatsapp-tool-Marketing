import { getDeal } from "@/lib/agent/read/deals";
import { withAgent } from "@/lib/agent/withAgent";

// get_deal: one confirmed project with stage history and line items.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_deal",
  async ({ params }) => {
    const body = await getDeal(params.id);
    return { body, recordIds: [body.id] };
  },
  { mutating: false },
);
