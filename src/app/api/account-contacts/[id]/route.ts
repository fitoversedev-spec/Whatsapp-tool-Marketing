import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

async function loadAuthorized(id: string, userId: string, role: string) {
  const contact = await prisma.accountContact.findUnique({
    where: { id },
    include: { account: { select: { id: true, name: true, city: true, ownerUserId: true } } },
  });
  if (!contact || contact.deletedAt) return { error: "not_found" as const, status: 404 };
  if (!isAdmin(role) && contact.account.ownerUserId && contact.account.ownerUserId !== userId) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { contact };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAuthorized(params.id, user.id, user.role);
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
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone;
  if (parsed.data.email !== undefined) data.email = parsed.data.email;
  if (parsed.data.designation !== undefined) data.designation = parsed.data.designation;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.fields !== undefined) data.fields = JSON.stringify(parsed.data.fields);

  const accountData: Record<string, unknown> = {};
  if (parsed.data.siteCity !== undefined) accountData.city = parsed.data.siteCity;
  if (parsed.data.customerProfileId !== undefined) accountData.customerProfileId = parsed.data.customerProfileId;
  if (parsed.data.businessType !== undefined) accountData.businessType = parsed.data.businessType;

  const updated = await prisma.$transaction(async (tx) => {
    // Was previously only handled in the `true` case, which silently no-opped
    // when unchecking "Primary" — `if (parsed.data.isPrimary)` skips `false`.
    if (parsed.data.isPrimary !== undefined) {
      if (parsed.data.isPrimary) {
        await tx.accountContact.updateMany({
          where: { accountId: res.contact.accountId, id: { not: params.id } },
          data: { isPrimary: false },
        });
      }
      data.isPrimary = parsed.data.isPrimary;
    }
    if (Object.keys(accountData).length) {
      await tx.account.update({ where: { id: res.contact.accountId }, data: accountData });
    }
    return tx.accountContact.update({ where: { id: params.id }, data });
  });

  return NextResponse.json({ contact: updated });
}

// Soft delete (deletedAt, not a real row delete) — sales can delete a
// contact on an account they own, admin can delete any, same owner-or-admin
// scoping loadAuthorized already applies to GET/PATCH. A hard delete would
// hit a bare FK RESTRICT the instant any Deal still points at this contact
// as primaryContactId (see the schema comment), so soft delete isn't just
// the safer choice here, it's the only one that reliably works.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.accountContact.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
