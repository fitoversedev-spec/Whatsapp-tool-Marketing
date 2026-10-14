import { withPathIds } from "@/lib/agent/leads/pathIds";
import { sendQuote } from "@/lib/agent/quotes/send";
import { sendQuoteInputSchema } from "@/lib/agent/schemas/quotes";
import { withAgent } from "@/lib/agent/withAgent";

// send_quote: WhatsApps an APPROVED quotation. 403 quote_not_approved otherwise; 409 handoff_required when the 24 h window is closed.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("send_quote", sendQuote, { mutating: true, inputSchema: sendQuoteInputSchema }),
  { id: "quotationId" },
);
