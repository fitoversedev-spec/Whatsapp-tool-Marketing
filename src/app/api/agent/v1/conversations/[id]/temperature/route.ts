import { withAgent } from "@/lib/agent/withAgent";
import { setLeadTemperature } from "@/lib/agent/insights";
import { setLeadTemperatureBody } from "@/lib/agent/schemas/insights";

// set_lead_temperature: the AI's hot / warm / cold label on a chat.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withAgent("set_lead_temperature", setLeadTemperature, {
  mutating: true,
  inputSchema: setLeadTemperatureBody,
});
