import { createFollowupTask } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { createFollowupInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// create_followup_task: Creates a follow-up task whose reminder goes to a human.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("create_followup_task", createFollowupTask, { mutating: true, inputSchema: createFollowupInputSchema }),
  { id: "leadId" },
);
