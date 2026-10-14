import { getQuotePdf } from "@/lib/agent/quotes/reads";
import { withAgent } from "@/lib/agent/withAgent";

// get_quote_pdf: a staff-only link to the saved PDF. The customer-facing link exists only for an approved quotation.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("get_quote_pdf", getQuotePdf, { mutating: false });
