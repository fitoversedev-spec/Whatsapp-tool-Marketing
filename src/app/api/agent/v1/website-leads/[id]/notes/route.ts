import { addNote } from "@/lib/agent/website/service";
import { withPathIds } from "@/lib/agent/leads/pathIds";
import { addWebsiteLeadNoteInputSchema } from "@/lib/agent/schemas/website";
import { withAgent } from "@/lib/agent/withAgent";

// add_website_lead_note: adds a note to a website lead, authored by the AI.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withPathIds(
  withAgent("add_website_lead_note", addNote, { mutating: true, inputSchema: addWebsiteLeadNoteInputSchema }),
  { id: "websiteLeadId" },
);
