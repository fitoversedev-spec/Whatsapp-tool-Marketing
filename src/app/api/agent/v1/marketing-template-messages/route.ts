import { withAgent } from "@/lib/agent/withAgent";
import { sendMarketingTemplateHandler } from "@/lib/agent/messaging/send";
import { sendMarketingTemplateBody } from "@/lib/agent/schemas/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// Default verdict is APPROVAL: withAgent queues the request and answers 202
// before this handler is reached.
export const POST = withAgent("send_marketing_template", sendMarketingTemplateHandler, {
  mutating: true,
  inputSchema: sendMarketingTemplateBody,
});
