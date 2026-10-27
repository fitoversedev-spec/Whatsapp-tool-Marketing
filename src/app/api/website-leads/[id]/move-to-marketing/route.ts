// "Move to WhatsApp marketing" for a website lead — creates (or reuses) the
// WhatsApp marketing Contact for its phone, exactly like an ad lead's
// move-to-marketing (an existing contact is never duplicated and its
// allowCampaign opt-out is never touched). Open to all signed-in users.
//
// [id] is WebsiteLead.id.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { moveWebsiteLeadToMarketing } from "@/lib/website-leads/writes";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await moveWebsiteLeadToMarketing(params.id);
  if (r.kind === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.kind === "no_phone") return NextResponse.json({ error: "no_phone" }, { status: 422 });
  return NextResponse.json({ ok: true, created: r.created, contactId: r.contactId });
}
