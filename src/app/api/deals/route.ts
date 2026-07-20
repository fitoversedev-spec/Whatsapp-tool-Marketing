// Create + list Deals. Creation accepts EITHER an existing accountId OR
// inline account fields (creates the Account + a primary AccountContact in
// the same call) — the common "brand new customer" case shouldn't need two
// separate requests. Inline creation runs a duplicate check first (spec
// §4.1: exact case-insensitive name+city match) and returns 409 with the
// candidate unless confirmDuplicate:true is passed, rather than silently
// creating a second Account for the same real customer.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { buildDealCode, nextDealSequenceForYear, defaultFunnelStageId } from "@/lib/crm/deals";

const accountSchema = z.object({
  name: z.string().min(1).max(200),
  city: z.string().max(100).optional(),
  customerProfileId: z.string().uuid().optional(),
  businessType: z.enum(["B2B", "B2C", "B2G"]).optional(),
});

const createSchema = z
  .object({
    title: z.string().min(1).max(200),
    accountId: z.string().uuid().optional(),
    account: accountSchema.optional(),
    contactName: z.string().max(200).optional(),
    contactPhone: z.string().max(30).optional(),
    // An existing AccountContact to set as this deal's primary contact —
    // e.g. a "+ New Quotation" quick action from a Contact page that needs
    // a deal to attach to first. Caller is responsible for it belonging to
    // the same account (accountId or the inline-created account above).
    primaryContactId: z.string().uuid().optional(),
    leadSourceId: z.string().uuid().optional(),
    sourceDetail: z.string().max(200).optional(),
    siteCity: z.string().max(100).optional(),
    estimatedValue: z.number().min(0).max(999999999).optional(),
    conversationId: z.string().uuid().optional(),
    // Only the generic "+ New Deal" form actually asks for this — every
    // other caller of this route (quick-actions, lead-capture) is
    // unambiguously CRM-originated and leaves it unset, relying on the
    // "crm" default below.
    dealChannel: z.enum(["whatsapp", "crm"]).optional(),
    confirmDuplicate: z.boolean().optional(),
    // "Interested in" — spec §7.2's "key requirement": product interest
    // must be capturable BEFORE a quotation exists, so enquiry-volume and
    // quoted/won-volume can be compared per product. Written as
    // DealLineItem rows with isEnquiryOnly:true (quotationId stays null).
    interestedProductIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .refine((d) => !!d.accountId !== !!d.account, {
    message: "Provide exactly one of accountId or account",
  });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.data ?? "invalid_payload" }, { status: 400 });
  }
  const data = parsed.data;

  let accountId = data.accountId ?? null;

  if (!accountId && data.account) {
    if (!data.confirmDuplicate) {
      const candidate = await prisma.account.findFirst({
        where: {
          deletedAt: null,
          name: { equals: data.account.name, mode: "insensitive" },
          ...(data.account.city ? { city: { equals: data.account.city, mode: "insensitive" } } : {}),
        },
        select: { id: true, name: true, city: true },
      });
      if (candidate) {
        return NextResponse.json(
          { error: "possible_duplicate", candidate },
          { status: 409 },
        );
      }
    }

    const account = await prisma.account.create({
      data: {
        name: data.account.name,
        city: data.account.city ?? null,
        customerProfileId: data.account.customerProfileId ?? null,
        businessType: data.account.businessType ?? null,
        ownerUserId: user.id,
      },
    });
    accountId = account.id;

    if (data.contactName || data.contactPhone) {
      await prisma.accountContact.create({
        data: {
          accountId,
          name: data.contactName ?? data.account.name,
          phone: data.contactPhone ?? null,
          isPrimary: true,
        },
      });
    }
  }

  if (!accountId) {
    return NextResponse.json({ error: "invalid_account" }, { status: 400 });
  }

  const year = new Date().getFullYear();
  const currentStageId = await defaultFunnelStageId();

  let deal;
  let lastError: unknown = null;
  let nextSeq = await nextDealSequenceForYear(year);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      deal = await prisma.deal.create({
        data: {
          code: buildDealCode(year, nextSeq - 1),
          title: data.title,
          accountId,
          primaryContactId: data.primaryContactId ?? null,
          ownerUserId: user.id,
          currentStageId,
          leadSourceId: data.leadSourceId ?? null,
          sourceDetail: data.sourceDetail ?? null,
          // No dedicated site-city field on this form — for most deals
          // created here the account's own city IS where the project is
          // (a school building a court at its own address). Falls back to
          // it so Geography analytics has something rather than nothing;
          // a quote or court design generated later can correct it if the
          // real site turns out to differ (see docs/DECISIONS.md).
          siteCity: data.siteCity ?? data.account?.city ?? null,
          estimatedValue: data.estimatedValue ?? null,
          conversationId: data.conversationId ?? null,
          dealChannel: data.dealChannel ?? "crm",
        },
      });
      break;
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      nextSeq += 1;
    }
  }

  if (!deal) {
    console.error("[deals] code collision after retries", lastError);
    return NextResponse.json(
      { error: "Could not assign a unique deal code after retries. Try again in a moment." },
      { status: 503 },
    );
  }

  // Spec §7.2's "key requirement": product interest must be capturable
  // BEFORE a quotation exists, so enquiry-volume and quoted/won-volume can
  // be compared per product later. No single-sport context exists at deal
  // creation (unlike a quote, which is scoped to one court), so sportId
  // stays null here — best-effort, never fails deal creation.
  if (data.interestedProductIds?.length) {
    try {
      const products = await prisma.product.findMany({
        where: { id: { in: data.interestedProductIds } },
        select: { id: true, name: true, unit: true, priceInr: true },
      });
      if (products.length) {
        await prisma.dealLineItem.createMany({
          data: products.map((p) => ({
            dealId: deal!.id,
            quotationId: null,
            productId: p.id,
            sportId: null,
            label: p.name,
            quantity: 1,
            unit: p.unit ?? null,
            rate: p.priceInr ?? null,
            amount: null,
            isEnquiryOnly: true,
          })),
        });
      }
    } catch (err) {
      console.error("[deals] interested-product DealLineItem write failed", err);
    }
  }

  return NextResponse.json({ deal });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerId = searchParams.get("ownerId");
  const stageId = searchParams.get("stageId");
  const channel = searchParams.get("channel"); // "whatsapp" | "crm"

  // Sales sees only their own deals by default; admin sees everything
  // (matches the existing inbox/pipeline ownership-scoping pattern —
  // manager/management office-scoping lands when those roles get adopted
  // here per docs/DECISIONS.md).
  const where: Record<string, unknown> = {
    deletedAt: null,
    ...(stageId ? { currentStageId: stageId } : {}),
    ...(channel === "whatsapp" || channel === "crm" ? { dealChannel: channel } : {}),
  };
  if (ownerId) {
    where.ownerUserId = ownerId;
  } else if (!isAdmin(user.role)) {
    where.ownerUserId = user.id;
  }

  const deals = await prisma.deal.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      account: { select: { id: true, name: true, city: true } },
      currentStage: { select: { id: true, name: true, slug: true, stageType: true, colorHex: true } },
      owner: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ deals });
}
