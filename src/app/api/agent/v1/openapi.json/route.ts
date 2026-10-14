import { jsonResponse, resolveCorrelationId } from "@/lib/agent/errors";
import { buildOpenApi } from "@/lib/agent/openapi";

// Public: the machine-readable contract for the agent API. It describes shapes
// only — no keys, no data, no internals.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  return jsonResponse(buildOpenApi(), 200, correlationId);
}
