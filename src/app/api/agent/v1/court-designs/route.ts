import { createDesignDraft } from "@/lib/agent/designs/create";
import { listDesigns } from "@/lib/agent/designs/reads";
import { createDesignDraftBodySchema, listDesignsQuery } from "@/lib/agent/schemas/documents";
import { withAgent } from "@/lib/agent/withAgent";

// list_designs: only the named customer's designs. create_design_draft: an empty draft; a person draws it.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("list_designs", listDesigns, { mutating: false, inputSchema: listDesignsQuery });

export const POST = withAgent("create_design_draft", createDesignDraft, {
  mutating: true,
  inputSchema: createDesignDraftBodySchema,
});
