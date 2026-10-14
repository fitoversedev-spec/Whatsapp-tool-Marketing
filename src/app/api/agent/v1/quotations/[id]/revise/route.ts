import { withPathIds } from "@/lib/agent/leads/pathIds";
import { reviseQuote } from "@/lib/agent/quotes/drafts";
import { reviseQuoteInputSchema } from "@/lib/agent/schemas/quotes";
import { withAgent } from "@/lib/agent/withAgent";

// revise_quote: a new draft from an existing quotation, re-priced from the current rate sheet; the old one stays as history.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("revise_quote", reviseQuote, { mutating: true, inputSchema: reviseQuoteInputSchema }),
  { id: "quotationId" },
);
