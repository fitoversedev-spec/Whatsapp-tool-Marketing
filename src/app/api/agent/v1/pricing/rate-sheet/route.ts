import { getRateSheet } from "@/lib/agent/read/pricing";
import { rateSheetQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// get_rate_sheet: the standard rate sheet for one sport, and whether it is the admin-edited sheet or the built-in default.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_rate_sheet",
  async ({ input }) => ({ body: await getRateSheet(input.sport) }),
  { mutating: false, inputSchema: rateSheetQuerySchema },
);
