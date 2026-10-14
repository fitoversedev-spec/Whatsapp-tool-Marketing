import { listQuoteTemplates } from "@/lib/agent/quotes/reads";
import { listQuoteTemplatesQuerySchema } from "@/lib/agent/schemas/quotes";
import { withAgent } from "@/lib/agent/withAgent";

// list_quote_templates: the standard quotation layout for a sport. Read-only.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("list_quote_templates", listQuoteTemplates, {
  mutating: false,
  inputSchema: listQuoteTemplatesQuerySchema,
});
