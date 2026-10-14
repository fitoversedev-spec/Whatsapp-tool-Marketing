import { withAgent } from "@/lib/agent/withAgent";
import { recordOptOutHandler } from "@/lib/agent/messaging/consent";
import { recordOptOutBody } from "@/lib/agent/schemas/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withAgent("record_opt_out", recordOptOutHandler, {
  mutating: true,
  inputSchema: recordOptOutBody,
});
