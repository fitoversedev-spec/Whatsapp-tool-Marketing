import { addProductInterest } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { addProductInterestInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// add_product_interest: Records product interest (known catalogue ids only).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("add_product_interest", addProductInterest, { mutating: true, inputSchema: addProductInterestInputSchema }),
  { id: "leadId" },
);
