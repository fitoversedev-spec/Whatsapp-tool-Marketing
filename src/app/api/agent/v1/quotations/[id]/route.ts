import { withPathIds } from "@/lib/agent/leads/pathIds";
import { updateDraftQuote } from "@/lib/agent/quotes/drafts";
import { getQuote } from "@/lib/agent/quotes/reads";
import { updateDraftQuoteInputSchema } from "@/lib/agent/schemas/quotes";
import { withAgent } from "@/lib/agent/withAgent";

// get_quote: one quotation with its stage and approval state.
// update_draft_quote: quantities, in/out flags, notes and validity of a draft the AI created; always re-priced from the rate sheet.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("get_quote", getQuote, { mutating: false });

export const PATCH = withPathIds(
  withAgent("update_draft_quote", updateDraftQuote, { mutating: true, inputSchema: updateDraftQuoteInputSchema }),
  { id: "quotationId" },
);
