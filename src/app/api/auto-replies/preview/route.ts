// Admin-only rule preview. GET with ?text=... returns which rule (if
// any) would fire for that text + the response body that'd be sent.
// Doesn't actually send anything — pure dry-run for testing.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { matchAutoReplyRule, AUTO_REPLY_RULES } from "@/lib/auto-replies/rules";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const text = req.nextUrl.searchParams.get("text") ?? "";
  const matched = matchAutoReplyRule(text);

  return NextResponse.json({
    text,
    matched: matched
      ? {
          id: matched.id,
          name: matched.name,
          responseBody: matched.responseBody,
          cooldownHours: matched.cooldownHours,
        }
      : null,
    availableRules: AUTO_REPLY_RULES.map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
    })),
  });
}
