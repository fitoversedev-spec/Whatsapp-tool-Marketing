import { compareProductsByIds } from "@/lib/agent/read/catalogue";
import { compareBodySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// compare_products: read-only spec comparison of 2 to 4 products.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withAgent(
  "compare_products",
  async ({ input }) => {
    const body = await compareProductsByIds(input.productIds);
    return { body, recordIds: body.products.map((p) => p.id) };
  },
  { mutating: false, inputSchema: compareBodySchema },
);
