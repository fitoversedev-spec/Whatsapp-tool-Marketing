import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

// Any address under /api/agent/v1 that isn't a real tool answers in the same
// JSON error shape as every tool, instead of an HTML page. Real routes are
// more specific and always win over this catch-all.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notFound(): NextResponse {
  const correlationId = randomUUID();
  return NextResponse.json(
    { error: { code: "not_found", message: "No such tool. See /api/agent/v1/openapi.json.", correlationId } },
    { status: 404, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } },
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
