import { getInvoice } from "@/lib/agent/quotes/reads";
import { withAgent } from "@/lib/agent/withAgent";

// get_invoice: read-only; amounts and dates, no bank references or addresses.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("get_invoice", getInvoice, { mutating: false });
