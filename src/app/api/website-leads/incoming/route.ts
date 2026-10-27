// POST /api/website-leads/incoming?key=<secret> — where the Fitoverse website
// sends each "Build a court" enquiry (its LEAD_WEBHOOK_URL). Public, no login
// cookie: the secret in the URL is the only credential, checked against the
// sha256 hash in Settings (issued with scripts/website-lead-key.ts). Missing or
// wrong key -> 401.
//
// The website treats anything but 2xx as a failed delivery, so every lead we have
// dealt with answers 200: saved, already saved (the same website lead id twice is
// one row), or ignored because it is not from the live site. Only an unreadable
// or incomplete payload gets 400. The push to the admins runs after the reply.
//
// The request URL contains the secret: nothing here logs it.
import { NextRequest, NextResponse } from "next/server";
import { ingestWebsiteLead, isValidIncomingKey } from "@/lib/website-leads/ingest";

export const maxDuration = 30;

const MAX_BODY_CHARS = 100_000;

export async function POST(req: NextRequest) {
  if (!(await isValidIncomingKey(req.nextUrl.searchParams.get("key")))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const text = await req.text().catch(() => null);
  if (text === null) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  if (text.length > MAX_BODY_CHARS) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const result = await ingestWebsiteLead(body);
  if (result.kind === "invalid") return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  if (result.kind === "duplicate") return NextResponse.json({ ok: true, duplicate: true });
  if (result.kind === "ignored") return NextResponse.json({ ok: true, ignored: true });
  return NextResponse.json({ ok: true });
}
