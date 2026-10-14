import { getBroadcastStatus } from "@/lib/agent/deals/broadcasts";
import { withAgent } from "@/lib/agent/withAgent";

// get_broadcast_status: counters of the AI's own broadcasts only.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("get_broadcast_status", getBroadcastStatus, { mutating: false });
