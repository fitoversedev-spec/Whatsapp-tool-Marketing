import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { customerAccess } from "@/lib/rbac";
import { parseFields } from "@/lib/contacts";
import { describeChanges, logContactEvents, type ContactEventInput } from "@/lib/crm/contactEvents";
import { firstLeadStage } from "@/lib/crm/leadStages";

async function loadAuthorized(id: string, user: { id: string; role: string }, need: "view" | "edit") {
  const contact = await prisma.accountContact.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, city: true, ownerUserId: true, customerProfileId: true, businessType: true } },
      leadStage: { select: { name: true } },
    },
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

  let newStage: { id: string; name: string } | null | undefined;
  if (input.leadStageId !== undefined && input.leadStageId !== before.leadStageId) {
    if (input.leadStageId) {
      const stage = await prisma.leadStage.findUnique({ where: { id: input.leadStageId }, select: { id: true, name: true, isActive: true, deletedAt: true } });
      if (!stage || stage.deletedAt || !stage.isActive) return NextResponse.json({ error: "Stage not available" }, { status: 422 });
      newStage = { id: stage.id, name: stage.name };
    } else {
      newStage = null;
    }
  }
  const movingIntoLeads = input.pipelineStage === "LEAD" && before.pipelineStage !== "LEAD";
  const leavingLeads = input.pipelineStage === null && before.pipelineStage === "LEAD";
  // Someone moved into Leads without a stage of their own starts at the first one.
  if (movingIntoLeads && newStage === undefined && !before.leadStageId) {
    newStage = (await firstLeadStage()) ?? undefined;
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.email !== undefined) data.email = input.email;
  if (input.designation !== undefined) data.designation = input.designation;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.fields !== undefined) data.fields = JSON.stringify(input.fields);
  if (input.leadSourceId !== undefined) data.leadSourceId = input.leadSourceId;
  if (newStage !== undefined) data.leadStageId = newStage?.id ?? null;
  if (input.pipelineStage !== undefined) {
    data.pipelineStage = input.pipelineStage;
    // Stamp the FIRST promotion to LEAD for the analytics Leads window; guard
    // against overwriting an existing timestamp when the row is already a LEAD.
    if (input.pipelineStage === "LEAD" && !before.promotedToLeadAt) {
      data.promotedToLeadAt = new Date();
    }
  }

  const accountData: Record<string, unknown> = {};
  if (input.siteCity !== undefined) accountData.city = input.siteCity;
  if (input.customerProfileId !== undefined) accountData.customerProfileId = input.customerProfileId;
  if (input.businessType !== undefined) accountData.businessType = input.businessType;

  const updated = await prisma.$transaction(async (tx) => {
    // Was previously only handled in the `true` case, which silently no-opped
    // when unchecking "Primary" — `if (parsed.data.isPrimary)` skips `false`.
    if (input.isPrimary !== undefined) {
      if (input.isPrimary) {
        await tx.accountContact.updateMany({
          where: { accountId: before.accountId, id: { not: params.id } },
          data: { isPrimary: false },
        });
      }
      data.isPrimary = input.isPrimary;
    }
    if (Object.keys(accountData).length) {
      await tx.account.update({ where: { id: before.accountId }, data: accountData });
    }
    return tx.accountContact.update({ where: { id: params.id }, data });
  });

  await logContactEvents(await describePatch(params.id, user.id, before, input, { newStage, movingIntoLeads, leavingLeads }));

  return NextResponse.json({ contact: updated });
}

type LoadedContact = Exclude<Awaited<ReturnType<typeof loadAuthorized>>, { error: unknown }>["contact"];

// Timeline entries for one PATCH: a details edit (old → new per field), a
// stage change, and a move into / out of Leads — each its own entry.
async function describePatch(
  contactId: string,
  actorUserId: string,
  before: LoadedContact,
  input: z.infer<typeof patchSchema>,
  moves: { newStage: { id: string; name: string } | null | undefined; movingIntoLeads: boolean; leavingLeads: boolean },
): Promise<ContactEventInput[]> {
  const nameOf = async (model: "leadSource" | "customerProfile", id: string | null | undefined) => {
    if (!id) return null;
    const row = model === "leadSource"
      ? await prisma.leadSource.findUnique({ where: { id }, select: { name: true } })
      : await prisma.customerProfile.findUnique({ where: { id }, select: { name: true } });
    return row?.name ?? null;
  };

  const pairs: [string, string | null | undefined, string | null | undefined][] = [];
  if (input.name !== undefined) pairs.push(["Name", before.name, input.name]);
  if (input.phone !== undefined) pairs.push(["Phone", before.phone, input.phone]);
  if (input.email !== undefined) pairs.push(["Email", before.email, input.email]);
  if (input.designation !== undefined) pairs.push(["Designation", before.designation, input.designation]);
  if (input.notes !== undefined) pairs.push(["What this lead wants", before.notes, input.notes]);
  if (input.siteCity !== undefined) pairs.push(["City", before.account.city, input.siteCity]);
  if (input.businessType !== undefined) pairs.push(["Business type", before.account.businessType, input.businessType]);
  if (input.isPrimary !== undefined) pairs.push(["Primary contact", before.isPrimary ? "Yes" : "No", input.isPrimary ? "Yes" : "No"]);
  if (input.leadSourceId !== undefined && input.leadSourceId !== before.leadSourceId) {
    pairs.push(["Lead source", await nameOf("leadSource", before.leadSourceId), await nameOf("leadSource", input.leadSourceId)]);
  }
  if (input.customerProfileId !== undefined && input.customerProfileId !== before.account.customerProfileId) {
    pairs.push(["Customer segment", await nameOf("customerProfile", before.account.customerProfileId), await nameOf("customerProfile", input.customerProfileId)]);
  }
  if (input.fields !== undefined) {
    const oldFields = parseFields(before.fields);
    for (const key of Array.from(new Set([...Object.keys(oldFields), ...Object.keys(input.fields)]))) {
      pairs.push([key, oldFields[key], input.fields[key]]);
    }
  }

  const events: ContactEventInput[] = [];
  const lines = describeChanges(pairs);
  if (lines.length) {
    events.push({ contactId, actorUserId, kind: "details_edited", summary: "Details edited", detail: lines.join("\n") });
  }
  if (moves.movingIntoLeads) {
    events.push({ contactId, actorUserId, kind: "lead_added", summary: "Moved to Leads" });
  }
  if (moves.leavingLeads) {
    events.push({ contactId, actorUserId, kind: "lead_removed", summary: "Removed from Leads" });
  }
  if (moves.newStage !== undefined) {
    events.push({
      contactId,
      actorUserId,
      kind: "stage_changed",
      summary: `Stage: ${before.leadStage?.name ?? "No stage"} → ${moves.newStage?.name ?? "No stage"}`,
    });
  }
  return events;
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
