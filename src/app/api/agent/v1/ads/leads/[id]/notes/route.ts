import { addAdLeadNote } from "@/lib/agent/leads/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { addAdLeadNoteInputSchema } from "@/lib/agent/schemas/leads";
import { withAgent } from "@/lib/agent/withAgent";

// add_ad_lead_note: Adds a note to a captured Meta ad lead.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("add_ad_lead_note", addAdLeadNote, { mutating: true, inputSchema: addAdLeadNoteInputSchema }),
  { id: "adLeadId" },
);
