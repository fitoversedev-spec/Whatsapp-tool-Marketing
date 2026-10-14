import { getDesign } from "@/lib/agent/designs/reads";
import { getDesignQuery } from "@/lib/agent/schemas/documents";
import { withAgent } from "@/lib/agent/withAgent";

// get_design: metadata of one design, only when it belongs to the customer named in the query.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("get_design", getDesign, { mutating: false, inputSchema: getDesignQuery });
