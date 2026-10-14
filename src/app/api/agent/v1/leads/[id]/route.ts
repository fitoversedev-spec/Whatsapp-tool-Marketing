import { getLead } from "@/lib/agent/read/leads";
import { withAgent } from "@/lib/agent/withAgent";
import { updateLeadDetails } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { updateLeadDetailsInputSchema } from "@/lib/agent/schemas/leads";

// get_lead: one customer's full detail, without private rep insights or attachments.
// Exports GET only so a later stage can add PATCH to this same file.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "get_lead",
  async ({ params }) => {
    const body = await getLead(params.id);
    return { body, recordIds: [body.id] };
  },
  { mutating: false },
);

// update_lead_details: name, designation, email, city, notes and custom fields (merged). Not the phone number.
export const PATCH = withPathIds(
  withAgent("update_lead_details", updateLeadDetails, { mutating: true, inputSchema: updateLeadDetailsInputSchema }),
  { id: "leadId" },
);
