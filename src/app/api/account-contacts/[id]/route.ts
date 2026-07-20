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
  if (!contact) return { error: "not_found" as const, status: 404 };
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
    return tx.accountContact.update({ where: { id: params.id }, data });
  });

  return NextResponse.json({ contact: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.accountContact.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
