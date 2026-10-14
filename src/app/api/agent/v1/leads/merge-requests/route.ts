import { requestMerge } from "@/lib/agent/leads/service";
import { requestMergeInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// request_merge: Verdict APPROVAL: records a merge request for a human. The AI never merges leads.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withAgent("request_merge", requestMerge, { mutating: true, inputSchema: requestMergeInputSchema });
