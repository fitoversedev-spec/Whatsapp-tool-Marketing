import { withAgent } from "@/lib/agent/withAgent";
import { listTemplatesHandler } from "@/lib/agent/messaging/reads";
import { listTemplatesQuery } from "@/lib/agent/schemas/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = withAgent("list_templates", listTemplatesHandler, {
  mutating: false,
  inputSchema: listTemplatesQuery,
});
