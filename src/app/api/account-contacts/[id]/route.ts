import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { customerAccess } from "@/lib/rbac";
import { applyContactPatch, ContactPatchError, PATCH_CONTACT_INCLUDE } from "@/lib/crm/contactPatch";

async function loadAuthorized(id: string, user: { id: string; role: string }, need: "view" | "edit") {
  const contact = await prisma.accountContact.findUnique({
    where: { id },
    include: PATCH_CONTACT_INCLUDE,
  });
  if (!contact || contact.deletedAt) return { error: "not_found" as const, status: 404 };
  const access = customerAccess(user, contact.account.ownerUserId);
  if (need === "view" ? !access.canView : !access.canEdit) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { contact };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAuthorized(params.id, user, "view");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const deals = await prisma.deal.findMany({
    where: { primaryContactId: params.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, code: true, title: true, quotedValue: true, wonValue: true,
      currentStage: { select: { name: true, colorHex: true, stageType: true } },
    },
  });

  return NextResponse.json({ contact: res.contact, deals });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  designation: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  fields: z.record(z.string()).optional(),
  isPrimary: z.boolean().optional(),
  // These three live on the parent Account, not AccountContact — same
  // fields the New Contact flow sets at creation (POST /api/account-contacts),
  // now editable after the fact too instead of being create-only.
  siteCity: z.string().max(100).nullable().optional(),
  customerProfileId: z.string().uuid().nullable().optional(),
  businessType: z.enum(["B2B", "B2C", "B2G"]).nullable().optional(),
  leadSourceId: z.string().uuid().nullable().optional(),
  // "Move to Leads" (set "LEAD") / "Remove from Leads" (null). Only these two
  // values — "converted" is derived from having a Deal, never stored here.
  pipelineStage: z.enum(["LEAD"]).nullable().optional(),
  // The contact's sales stage. Independent of pipelineStage: picking a stage
  // never moves anyone into Leads.
  leadStageId: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAuthorized(params.id, user, "edit");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  const before = res.contact;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const input = parsed.data;

  try {
    const updated = await applyContactPatch({ before, input, actorUserId: user.id });
    return NextResponse.json({ contact: updated });
  } catch (err) {
    if (err instanceof ContactPatchError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// Soft delete (deletedAt, not a real row delete) — sales can delete a
// contact on an account they own, admin/manager can delete any, same
// access rule loadAuthorized already applies to PATCH. A hard delete would
// hit a bare FK RESTRICT the instant any Deal still points at this contact
// as primaryContactId (see the schema comment), so soft delete isn't just
// the safer choice here, it's the only one that reliably works.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await loadAuthorized(params.id, user, "edit");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.accountContact.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
