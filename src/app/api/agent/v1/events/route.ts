import { withAgent } from "@/lib/agent/withAgent";
import { getEventsHandler } from "@/lib/agent/messaging/reads";
import { getEventsQuery } from "@/lib/agent/schemas/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = withAgent("get_events", getEventsHandler, {
  mutating: false,
  inputSchema: getEventsQuery,
});
