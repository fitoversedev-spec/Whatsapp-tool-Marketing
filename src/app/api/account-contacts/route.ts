// Create + list AccountContacts ("Contacts") — a person at a Company.
// AccountContact has no ownerUserId of its own; ownership scoping goes
// through its parent Account's owner, same as everywhere else this model
// is touched (e.g. Deal Detail's contact picker).
//
// POST doubles as a full "capture a new lead" flow, not just "add a person
// to an existing company": it accepts either an existing accountId OR
// inline account fields (mirroring POST /api/deals's own pattern), and
// optionally a dealStageId — when given, a Deal is created in the same
// request with this contact as its primary contact. See docs/DECISIONS.md.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { findAccountContactDuplicate, findAccountDuplicate } from "@/lib/crm/accounts";
import { buildDealCode, nextDealSequenceForYear } from "@/lib/crm/deals";

const createSchema = z
  .object({
    accountId: z.string().uuid().optional(),
    accountName: z.string().min(1).max(200).optional(),
    siteCity: z.string().max(100).optional(),
    customerProfileId: z.string().uuid().optional(),
    businessType: z.enum(["B2B", "B2C", "B2G"]).optional(),
    leadSourceId: z.string().uuid().optional(),
    name: z.string().min(1).max(200),
    phone: z.string().max(30).optional(),
    email: z.string().email().max(200).optional(),
    designation: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
    fields: z.record(z.string()).optional(),
    isPrimary: z.boolean().optional(),
    confirmDuplicate: z.boolean().optional(),
    // Presence of this field is what triggers auto-creating a Deal.
    dealStageId: z.string().uuid().optional(),
  })
  .refine((d) => !!d.accountId !== !!d.accountName, {
    message: "Provide exactly one of accountId or accountName",
  });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const data = parsed.data;

  let accountId = data.accountId ?? null;
  // Falls back to the account's own city when the caller doesn't pass an
  // explicit siteCity — mirrors POST /api/deals's inline-account fallback,
  // but that route only ever covered its own inline-create branch, leaving
  // deals attached to an EXISTING account with no site city at all (every
  // "+ New Quotation"-style deal from an already-known contact showed up as
  // "(unspecified)" in Geography analytics, even though the account had a
  // city on file the whole time).
  let accountCity: string | null = null;

  if (accountId) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.deletedAt) return NextResponse.json({ error: "account_not_found" }, { status: 404 });
    if (!isAdmin(user.role) && account.ownerUserId && account.ownerUserId !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    accountCity = account.city;
  } else if (data.accountName) {
    if (!data.confirmDuplicate) {
      const candidate = await findAccountDuplicate({ name: data.accountName, city: data.siteCity });
      if (candidate) {
        return NextResponse.json({ error: "possible_duplicate", candidate }, { status: 409 });
      }
    }
    const account = await prisma.account.create({
      data: {
        name: data.accountName,
        city: data.siteCity ?? null,
        customerProfileId: data.customerProfileId ?? null,
        businessType: data.businessType ?? null,
        ownerUserId: user.id,
      },
    });
    accountId = account.id;
    accountCity = account.city;
  }
  if (!accountId) return NextResponse.json({ error: "invalid_account" }, { status: 400 });

  if (!data.confirmDuplicate) {
    const candidate = await findAccountContactDuplicate({ phone: data.phone, name: data.name, accountId });
    if (candidate) {
      return NextResponse.json({ error: "possible_duplicate", candidate }, { status: 409 });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.accountContact.updateMany({ where: { accountId }, data: { isPrimary: false } });
    }
    const contact = await tx.accountContact.create({
      data: {
        accountId: accountId!,
        name: data.name,
        phone: data.phone ?? null,
        email: data.email ?? null,
        designation: data.designation ?? null,
        notes: data.notes ?? null,
        fields: JSON.stringify(data.fields ?? {}),
        isPrimary: data.isPrimary ?? false,
      },
    });

    let dealId: string | null = null;
    if (data.dealStageId) {
      const year = new Date().getFullYear();
      const seq = await nextDealSequenceForYear(year);
      const deal = await tx.deal.create({
        data: {
          code: buildDealCode(year, seq - 1),
          title: `${data.name} — ${data.accountName ?? "New deal"}`,
          accountId: accountId!,
          primaryContactId: contact.id,
          ownerUserId: user.id,
          currentStageId: data.dealStageId,
          leadSourceId: data.leadSourceId ?? null,
          siteCity: data.siteCity ?? accountCity,
          dealChannel: "crm",
        },
      });
      dealId = deal.id;
    }

    return { contact, dealId };
  });

  return NextResponse.json({ contact: result.contact, dealId: result.dealId });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const accountId = searchParams.get("accountId");

  const where: Record<string, unknown> = {
    deletedAt: null,
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    ...(accountId ? { accountId } : {}),
  };
  if (!isAdmin(user.role)) {
    where.account = { ownerUserId: user.id };
  }

  const contacts = await prisma.accountContact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { account: { select: { id: true, name: true, city: true } } },
  });

  return NextResponse.json({ contacts });
}
