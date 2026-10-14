import { serverEnvironment } from "@/lib/agent/context";
import { jsonResponse, resolveCorrelationId } from "@/lib/agent/errors";

// Public liveness check for the agent API. Reveals nothing but "up", the API
// version and which environment this deployment serves.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  return jsonResponse({ ok: true, version: "v1", environment: serverEnvironment() }, 200, correlationId);
}
