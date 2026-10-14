import { checkAvailability } from "@/lib/agent/read/catalogue";
import { withAgent } from "@/lib/agent/withAgent";

// check_availability: stock is not tracked here, so the answer is always "unknown".
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "check_availability",
  async ({ params }) => {
    const body = await checkAvailability(params.id);
    return { body, recordIds: [body.productId] };
  },
  { mutating: false },
);
