import { pauseBroadcast } from "@/lib/agent/deals/broadcasts";
import { pauseBroadcastBodySchema } from "@/lib/agent/schemas/deals";
import { withAgent } from "@/lib/agent/withAgent";

// pause_broadcast: the fail-safe stop. It can only stop things.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withAgent("pause_broadcast", pauseBroadcast, {
  mutating: true,
  inputSchema: pauseBroadcastBodySchema,
});
