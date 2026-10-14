import { quoteHistory } from "@/lib/agent/quotes/reads";
import { withAgent } from "@/lib/agent/withAgent";

// quote_history: the version chain (revisions, approved discounts) with approval fields.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("quote_history", quoteHistory, { mutating: false });
