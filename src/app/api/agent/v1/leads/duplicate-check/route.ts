import { checkDuplicates } from "@/lib/agent/read/leads";
import { duplicateCheckBodySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// check_duplicates: read-only. Looks the person up by phone, company and name across CRM leads and
// contacts, WhatsApp contacts and ad leads. It never creates or changes anything, so it is not mutating.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withAgent(
  "check_duplicates",
  async ({ input }) => {
    const body = await checkDuplicates(input);
    return { body, recordIds: body.matches.map((m) => m.id) };
  },
  { mutating: false, inputSchema: duplicateCheckBodySchema },
);
