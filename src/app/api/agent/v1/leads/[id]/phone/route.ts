import { updateLeadPhone } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { updateLeadPhoneInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// update_lead_phone: Verdict APPROVAL: withAgent queues a request for a human; this handler runs only when an approval is executed.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const PATCH = withPathIds(
  withAgent("update_lead_phone", updateLeadPhone, { mutating: true, inputSchema: updateLeadPhoneInputSchema }),
  { id: "leadId" },
);
