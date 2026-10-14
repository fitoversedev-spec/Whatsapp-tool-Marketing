import { completeTask } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { completeTaskInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// complete_task: Completes a task, but only one the AI created.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const PATCH = withPathIds(
  withAgent("complete_task", completeTask, { mutating: true, inputSchema: completeTaskInputSchema }),
  { id: "taskId" },
);
