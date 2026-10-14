import { launchBroadcast } from "@/lib/agent/deals/broadcasts";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { launchBroadcastInputSchema } from "@/lib/agent/schemas/deals";
import { withAgent } from "@/lib/agent/withAgent";

// launch_broadcast: Verdict APPROVAL: withAgent queues a request for a human; this handler runs only when an approval is executed.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("launch_broadcast", launchBroadcast, { mutating: true, inputSchema: launchBroadcastInputSchema }),
  { id: "broadcastId" },
);
