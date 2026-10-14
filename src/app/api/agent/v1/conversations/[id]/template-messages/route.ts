import { withAgent } from "@/lib/agent/withAgent";
import { sendTemplateHandler } from "@/lib/agent/messaging/send";
import { sendTemplateBody } from "@/lib/agent/schemas/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withAgent("send_template", sendTemplateHandler, {
  mutating: true,
  inputSchema: sendTemplateBody,
});
