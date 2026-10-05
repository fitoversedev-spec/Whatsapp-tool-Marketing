// Bulk "Move to Leads" (or undo) — the multi-select counterpart to
// PATCH /api/account-contacts/[id]'s pipelineStage write. Same per-item
// access rule and granular skip-counting convention as bulk-delete/route.ts.
// "converted" is never stored — it's derived from a contact having a Deal —
// so the only values accepted here are "LEAD" / null.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { customerAccess } from "@/lib/rbac";
import { firstLeadStage } from "@/lib/crm/leadStages";
import { logContactEvents, type ContactEventInput } from "@/lib/crm/contactEvents";

const schema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(200),
  pipelineStage: z.enum(["LEAD"]).nullable(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const contacts = await prisma.accountContact.findMany({
    where: { id: { in: parsed.data.contactIds }, deletedAt: null },
    select: { id: true, pipelineStage: true, leadStageId: true, promotedToLeadAt: true, account: { select: { ownerUserId: true } } },
  });

  const allowed: typeof contacts = [];
  let skippedForbidden = 0;
  for (const contact of contacts) {
    if (!customerAccess(user, contact.account.ownerUserId).canEdit) {
      skippedForbidden++;
      continue;
    }
    allowed.push(contact);
  }

  const promoting = parsed.data.pipelineStage === "LEAD";
  // Only rows whose Leads membership actually changes get written and logged.
  const changing = allowed.filter((c) => (promoting ? c.pipelineStage !== "LEAD" : c.pipelineStage === "LEAD"));
  const events: ContactEventInput[] = [];

  if (changing.length) {
    const ids = changing.map((c) => c.id);
    if (promoting) {
      const stage = await firstLeadStage();
      const now = new Date();
      await prisma.$transaction([
        prisma.accountContact.updateMany({ where: { id: { in: ids } }, data: { pipelineStage: "LEAD" } }),
        // Stamp promotedToLeadAt for the analytics Leads window only on rows
        // never promoted before, so a repeat move keeps the original timestamp.
        prisma.accountContact.updateMany({ where: { id: { in: ids }, promotedToLeadAt: null }, data: { promotedToLeadAt: now } }),
        // Someone moved in without a stage of their own starts at the first one.
        ...(stage ? [prisma.accountContact.updateMany({ where: { id: { in: ids }, leadStageId: null }, data: { leadStageId: stage.id } })] : []),
      ]);
      for (const c of changing) {
        events.push({ contactId: c.id, actorUserId: user.id, kind: "lead_added", summary: "Moved to Leads" });
        if (stage && !c.leadStageId) {
          events.push({ contactId: c.id, actorUserId: user.id, kind: "stage_changed", summary: `Stage: No stage → ${stage.name}` });
        }
      }
    } else {
      await prisma.accountContact.updateMany({ where: { id: { in: ids } }, data: { pipelineStage: null } });
      for (const c of changing) events.push({ contactId: c.id, actorUserId: user.id, kind: "lead_removed", summary: "Removed from Leads" });
    }
  }
  await logContactEvents(events);

  return NextResponse.json({ updated: allowed.length, skippedForbidden });
}
