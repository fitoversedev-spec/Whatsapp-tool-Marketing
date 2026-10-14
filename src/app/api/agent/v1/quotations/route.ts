import { createDraftQuote } from "@/lib/agent/quotes/drafts";
import { listQuotes } from "@/lib/agent/quotes/reads";
import { createDraftQuoteInputSchema, listQuotesQuerySchema } from "@/lib/agent/schemas/quotes";
import { withAgent } from "@/lib/agent/withAgent";

// list_quotes: quotations for a lead / conversation (or, with neither, the ones the AI created).
// create_draft_quote: a DRAFT quotation priced from the rate sheet; it cannot be sent until a person approves it.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("list_quotes", listQuotes, { mutating: false, inputSchema: listQuotesQuerySchema });

export const POST = withAgent("create_draft_quote", createDraftQuote, { mutating: true, inputSchema: createDraftQuoteInputSchema });
