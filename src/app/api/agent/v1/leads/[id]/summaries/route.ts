import { saveConversationSummary } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { saveSummaryInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// save_conversation_summary: Saves an AI conversation summary as a note and logs it on the timeline.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("save_conversation_summary", saveConversationSummary, { mutating: true, inputSchema: saveSummaryInputSchema }),
  { id: "leadId" },
);
