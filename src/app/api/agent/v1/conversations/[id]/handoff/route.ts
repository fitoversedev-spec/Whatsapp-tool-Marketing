import { withPathIds } from "@/lib/agent/leads/pathIds";
import { requestHumanHandoff } from "@/lib/agent/handoffs/service";
import { requestHumanHandoffInputSchema } from "@/lib/agent/schemas/handoffs";
import { withAgent } from "@/lib/agent/withAgent";

// request_human_handoff: the customer asked for a person; an admin assigns one.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("request_human_handoff", requestHumanHandoff, { mutating: true, inputSchema: requestHumanHandoffInputSchema }),
  { id: "conversationId" },
);
