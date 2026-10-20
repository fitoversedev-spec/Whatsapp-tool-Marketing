import { withAgent } from "@/lib/agent/withAgent";
import { getAiStatus } from "@/lib/agent/handoffs/service";

// get_ai_status: may the AI message this chat right now?
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = withAgent("get_ai_status", getAiStatus, { mutating: false });
