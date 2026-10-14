import { withPathIds } from "@/lib/agent/leads/pathIds";
import { submitQuoteForApproval } from "@/lib/agent/quotes/approval";
import { submitQuoteInputSchema } from "@/lib/agent/schemas/quotes";
import { withAgent } from "@/lib/agent/withAgent";

// submit_quote_for_approval: locks the draft as "pending" and queues an approve_quote request for a person.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("submit_quote_for_approval", submitQuoteForApproval, { mutating: true, inputSchema: submitQuoteInputSchema }),
  { id: "quotationId" },
);
