// The @-autocomplete backend. Returns categorized taggable suggestions —
// people, customers, leads, deals, quotations, court designs — filtered by the
// query. Records honor Option B (a non-admin only ever sees ones they can
// access). Two optional narrowing dimensions:
//   • context = an accountContactId → deals/quotes/designs narrow to that
//     customer's account.
//   • person  = a userId → records narrow to what THAT teammate owns (used in
//     a DM with them, or after tagging them in the team channel). Intersected
//     with Option B, so a non-admin never sees another rep's records this way.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/rbac";
import { resolveChatScope, contactOwnerWhere } from "@/lib/chat/scope";

export const runtime = "nodejs";
const TAKE = 6;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = resolveChatScope({ id: user.id, role: user.role as Role });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const context = req.nextUrl.searchParams.get("context"); // an accountContactId
  const person = req.nextUrl.searchParams.get("person"); // a userId to scope records to
  const like = q ? ({ contains: q, mode: "insensitive" } as const) : undefined;

  // Effective record owner = Option-B scope ∩ the person filter.
  //   null   → no owner restriction (admin with no person filter)
  //   "empty"→ impossible intersection (non-admin asking for another rep's) → no records
  //   <id>   → records owned by this user id
  let ownerId: string | null | "empty";
  if (scope.companyWide) ownerId = person ?? null;
  else ownerId = person && person !== scope.userId ? "empty" : scope.userId;
  const noRecords = ownerId === "empty";

  const ownerContact = ownerId && ownerId !== "empty" ? { account: { ownerUserId: ownerId } } : {};
  const ownerDeal = ownerId && ownerId !== "empty" ? { ownerUserId: ownerId } : {};
  const ownerDoc =
    ownerId && ownerId !== "empty"
      ? { OR: [{ deal: { ownerUserId: ownerId } }, { dealId: null, createdByUserId: ownerId }] }
      : {};

  // Resolve the customer-context to its account (only if the caller may see it).
  let contextAccountId: string | null = null;
  if (context) {
    const c = await prisma.accountContact.findFirst({
      where: { id: context, deletedAt: null, ...contactOwnerWhere(scope) },
      select: { accountId: true },
    });
    contextAccountId = c?.accountId ?? null;
  }
  const dealContext = contextAccountId ? { accountId: contextAccountId } : {};
  const docContext = contextAccountId ? { deal: { accountId: contextAccountId } } : {};

  const [people, customers, leads, deals, quotations, courtImages] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, isActive: true, approvalStatus: "approved", ...(like ? { name: like } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: TAKE,
    }),
    noRecords
      ? []
      : prisma.accountContact.findMany({
          where: { deletedAt: null, NOT: { pipelineStage: "LEAD" }, ...ownerContact, ...(like ? { OR: [{ name: like }, { phone: like }] } : {}) },
          select: { id: true, name: true, account: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: TAKE,
        }),
    noRecords
      ? []
      : prisma.accountContact.findMany({
          where: { deletedAt: null, pipelineStage: "LEAD", ...ownerContact, ...(like ? { OR: [{ name: like }, { phone: like }] } : {}) },
          select: { id: true, name: true, account: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: TAKE,
        }),
    noRecords
      ? []
      : prisma.deal.findMany({
          where: { deletedAt: null, ...ownerDeal, ...dealContext, ...(like ? { OR: [{ code: like }, { title: like }] } : {}) },
          select: { id: true, code: true, title: true },
          orderBy: { updatedAt: "desc" },
          take: TAKE,
        }),
    noRecords
      ? []
      : prisma.quotation.findMany({
          where: { ...ownerDoc, ...docContext, ...(like ? { OR: [{ number: like }, { sport: like }, { customerName: like }] } : {}) },
          select: { id: true, number: true, sport: true, customerName: true },
          orderBy: { createdAt: "desc" },
          take: TAKE,
        }),
    noRecords
      ? []
      : prisma.courtImage.findMany({
          where: { ...ownerDoc, ...docContext, ...(like ? { OR: [{ number: like }, { customerName: like }] } : {}) },
          select: { id: true, number: true, customerName: true },
          orderBy: { createdAt: "desc" },
          take: TAKE,
        }),
  ]);

  return NextResponse.json({
    people: people.map((u) => ({ refType: "user", id: u.id, label: u.name })),
    customers: customers.map((c) => ({ refType: "accountContact", id: c.id, label: c.name, sublabel: c.account.name })),
    leads: leads.map((c) => ({ refType: "lead", id: c.id, label: c.name, sublabel: c.account.name })),
    deals: deals.map((d) => ({ refType: "deal", id: d.id, label: d.title || d.code, sublabel: d.code })),
    // Labelled by CUSTOMER NAME (not the quote/design code) per request; the
    // number moves to the sublabel for reference.
    quotations: quotations.map((qt) => ({ refType: "quotation", id: qt.id, label: qt.customerName, sublabel: `${qt.number} · ${qt.sport}` })),
    courtImages: courtImages.map((ci) => ({ refType: "courtImage", id: ci.id, label: ci.customerName, sublabel: ci.number })),
  });
}
