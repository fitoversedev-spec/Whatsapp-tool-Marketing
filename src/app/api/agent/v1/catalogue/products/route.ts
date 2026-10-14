import { searchCatalogue } from "@/lib/agent/read/catalogue";
import { catalogueSearchQuerySchema } from "@/lib/agent/schemas/read";
import { withAgent } from "@/lib/agent/withAgent";

// search_catalogue: live products with specs, media and TDS titles. Prices are indicative only.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "search_catalogue",
  async ({ input }) => {
    const body = await searchCatalogue(input);
    return { body, recordIds: body.items.map((i) => i.id) };
  },
  { mutating: false, inputSchema: catalogueSearchQuerySchema },
);
