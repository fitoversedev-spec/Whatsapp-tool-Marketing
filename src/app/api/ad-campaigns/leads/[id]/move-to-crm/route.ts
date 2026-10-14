// "Move to CRM" for a Meta Instant-Form lead — the ad-campaign Leads table's
// per-row action that promotes a raw MetaLead into the live CRM. Mirrors the
// Inbox conversation flow (src/app/api/conversations/[id]/move-to-crm) but
// starts from a MetaLead instead of a WhatsApp Conversation, and is open to all
// approved reps (ad-campaign data isn't rep-scoped, so any rep can work a lead
// into the CRM and pick its owner). One POST, no form beyond the picked rep:
//   1. Already linked (MetaLead.accountContactId set) -> just return it.
//   2. An AccountContact already exists for this phone -> link to it.
//   3. Otherwise -> create Account + AccountContact(pipelineStage=LEAD) and link.
// The link is the MetaLead.accountContactId column (added in Phase A); nothing
// here creates a Deal — that's a later action from the CRM Contact/Lead detail.
//
// [id] is the MetaLead.id (not the raw Meta leadgen id).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { moveMetaLeadToCrm } from "@/lib/meta-ads/leadWrites";

const bodySchema = z.object({
  // The rep to own the created Account. Optional — when omitted, the Account is
  // created UNASSIGNED (the dialog's "Don't assign" choice), not self-assigned.
  ownerUserId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Open to all approved reps — reps work their own ad leads into the CRM.

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  // Owner = the picked rep, or null (left unassigned) when none was chosen.
  const result = await moveMetaLeadToCrm({
    metaLeadId: params.id,
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
