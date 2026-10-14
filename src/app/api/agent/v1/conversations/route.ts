import { withAgent } from "@/lib/agent/withAgent";
import { listConversationsHandler } from "@/lib/agent/messaging/reads";
import { listConversationsQuery } from "@/lib/agent/schemas/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = withAgent("list_conversations", listConversationsHandler, {
  mutating: false,
  inputSchema: listConversationsQuery,
});
