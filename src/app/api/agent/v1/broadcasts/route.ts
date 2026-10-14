import { draftBroadcast } from "@/lib/agent/deals/broadcasts";
import { draftBroadcastBodySchema } from "@/lib/agent/schemas/deals";
import { withAgent } from "@/lib/agent/withAgent";

// draft_broadcast: creates a DRAFT campaign from saved contacts only; nothing is sent.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withAgent("draft_broadcast", draftBroadcast, {
  mutating: true,
  inputSchema: draftBroadcastBodySchema,
});
