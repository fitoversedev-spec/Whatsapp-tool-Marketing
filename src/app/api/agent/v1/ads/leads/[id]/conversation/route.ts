import { withAgent } from "@/lib/agent/withAgent";
import { startLeadConversation } from "@/lib/agent/insights";
import { startLeadConversationBody } from "@/lib/agent/schemas/insights";

// start_lead_conversation: the first WhatsApp template to a new lead-form lead.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withAgent("start_lead_conversation", startLeadConversation, {
  mutating: true,
  inputSchema: startLeadConversationBody,
});
