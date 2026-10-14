import { requestMarkWon } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { requestMarkWonInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// request_mark_won: Verdict APPROVAL: creates the won deal once a human approves.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("request_mark_won", requestMarkWon, { mutating: true, inputSchema: requestMarkWonInputSchema }),
  { id: "leadId" },
);
