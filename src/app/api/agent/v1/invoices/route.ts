import { listInvoices } from "@/lib/agent/quotes/reads";
import { listInvoicesQuerySchema } from "@/lib/agent/schemas/quotes";
import { withAgent } from "@/lib/agent/withAgent";

// list_invoices: read-only; needs leadId or quotationId.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("list_invoices", listInvoices, { mutating: false, inputSchema: listInvoicesQuerySchema });
