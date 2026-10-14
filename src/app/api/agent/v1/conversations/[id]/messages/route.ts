import { withAgent } from "@/lib/agent/withAgent";
import { getMessagesHandler } from "@/lib/agent/messaging/reads";
import { sendReplyHandler } from "@/lib/agent/messaging/send";
import { getMessagesQuery, sendReplyBody } from "@/lib/agent/schemas/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = withAgent("get_messages", getMessagesHandler, {
  mutating: false,
  inputSchema: getMessagesQuery,
});

export const POST = withAgent("send_reply", sendReplyHandler, {
  mutating: true,
  inputSchema: sendReplyBody,
});
