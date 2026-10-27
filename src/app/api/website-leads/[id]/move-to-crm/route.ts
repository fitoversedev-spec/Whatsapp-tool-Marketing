// "Move to CRM" for a website lead — links it to the CRM contact for its phone
// (creating the Account + contact as a LEAD when there is none), attributed to
// the "website" lead source. Same flow and same shared code as an ad lead's
// move-to-crm. Open to all signed-in users. One POST, no form beyond the rep
// picked to own a new Account (omit it to leave the Account unassigned).
//
// [id] is WebsiteLead.id.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { moveWebsiteLeadToCrm } from "@/lib/website-leads/writes";

const bodySchema = z.object({
  ownerUserId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const result = await moveWebsiteLeadToCrm({
    websiteLeadId: params.id,
    actorUserId: user.id,
    ownerUserId: parsed.data.ownerUserId ?? null,
  });
  if (result.kind === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result.kind === "invalid_owner") return NextResponse.json({ error: "invalid_owner" }, { status: 400 });
  if (result.kind === "already_linked") {
    return NextResponse.json({ ok: true, alreadyLinked: true, accountContactId: result.accountContactId });
  }

  return NextResponse.json({
    ok: true,
    accountContactId: result.accountContactId,
    leadSourceId: result.leadSourceId,
    matchedExisting: result.matchedExisting,
    alreadyLinked: false,
  });
}
