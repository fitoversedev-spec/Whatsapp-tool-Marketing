/**
 * `POST /api/reports/{reportId}/share` — log the hand-over and mint the link.
 *
 * The response carries a `wa.me` URL with the message already written. The
 * salesperson opens it, picks the recipient in WhatsApp, and sends from their
 * own number — client answer **E1**. Nothing here talks to Meta, and nothing
 * here sends anything on anybody's behalf.
 *
 * The recipient name is optional and is asked for because the dashboard shows
 * "Sent to Deepa". A blank box is not an error; a blank string is not a name,
 * and `normaliseRecipient` makes sure it never becomes one.
 */

import { NextResponse } from "next/server";

import { getScoutProfile } from "@/lib/scout/identity";
import { recordShare } from "@/lib/scout/reports/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = new Set(["whatsapp", "pdf", "email"]);

export async function POST(request: Request, context: { params: { reportId: string } }) {
  // The delivery message is signed with the sender's name.
  const author = await getScoutProfile();
  if (!author) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!author.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const { reportId } = context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const payload = (body ?? {}) as { channel?: unknown; recipientName?: unknown };
  const channel = typeof payload.channel === "string" ? payload.channel : "whatsapp";
  if (!CHANNELS.has(channel)) {
    return NextResponse.json({ error: "Unknown share channel." }, { status: 400 });
  }

  let result;
  try {
    result = await recordShare({
      user: author,
      reportId,
      channel: channel as "whatsapp" | "pdf" | "email",
      recipientName: payload.recipientName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown share error.";
    console.error(JSON.stringify({ tag: "report.share.failed", reportId, error: message }));
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!result) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
