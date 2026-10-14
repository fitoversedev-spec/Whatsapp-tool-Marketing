import { withAgent } from "@/lib/agent/withAgent";
import { consentOffHandler } from "@/lib/agent/messaging/consent";
import { consentOffBody } from "@/lib/agent/schemas/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withAgent("set_campaign_consent_false", consentOffHandler, {
  mutating: true,
  inputSchema: consentOffBody,
});
