import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/webhook";
import { after } from "@/lib/scout/after";
import { planWebhook, saveInboundMessages, runDeferred } from "@/lib/whatsapp-webhook";

// Node runtime, never cached; the deferred work (media, replies, statuses)
// runs after the response but inside the same 60 s Vercel function.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Meta requires GET for verification handshake
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "verify_failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  // Use arrayBuffer for byte-exact body capture — req.text() can normalize
  // newlines on some platforms, breaking HMAC signature verification.
  const rawBuf = Buffer.from(await req.arrayBuffer());
  const raw = rawBuf.toString("utf8");
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyMetaSignature(raw, signature)) {
    // Log diagnostic info so we can see why Meta's real events fail HMAC
    // while curl tests pass. Logged but not exposed in response.
    console.error("[webhook] signature mismatch", {
      sigHeader: signature,
      bodyLen: rawBuf.length,
      bodyFirst200: raw.slice(0, 200),
      bodyLast50: raw.slice(-50),
      appSecretSet: !!process.env.META_APP_SECRET,
      appSecretLen: (process.env.META_APP_SECRET ?? "").length,
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const plan = planWebhook(payload);

  // Save the inbound messages BEFORE replying (no media download), so a message
  // is never lost: if this fails, answer 500 and Meta sends it again.
  let saved;
  try {
    saved = await saveInboundMessages(plan.inbound);
  } catch (err) {
    console.error("[webhook] saving inbound messages failed", err);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // Everything else — media, opt-out / chatbot / auto-replies, push, status
  // updates, templates, leads — runs after the 200 goes back to Meta.
  after(() => runDeferred(plan, saved, startedAt));

  return NextResponse.json({ ok: true });
}
