// Quotation list + create. Create is fed by the wizard's Step 2 submit —
// it freezes the line items (description, area, rate, GST) into a JSON
// snapshot on the row so the historical record stays accurate even when
// the rate sheet changes later.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { QUOTATION_LIST_SELECT } from "@/lib/quotation/list-select";
import { after } from "@/lib/scout/after";
import { recompute, lineItemSchema, type QuoteLineItem } from "@/lib/quotation/calculator";
import {
  createQuotationWithNumber,
  demotePrimaryQuotes,
  nextSequenceForYear,
  setDealQuotedValue,
  syncConversationDealValue,
  syncDealAccountClassification,
  writeDealLineItems,
} from "@/lib/quotation/service";
import { reconcileDealAfterQuotationDelete } from "@/lib/crm/deals";
import { applyDocumentClassification, logDocumentDeleted, resolveContactForDocument } from "@/lib/crm/contactLinks";

const createSchema = z.object({
  customerName: z.string().min(1).max(200),
  // The project's location, not stored on Quotation itself — written
  // through to Deal.siteCity, which Team Performance's Geography view reads.
  siteCity: z.string().max(100).optional(),
  sport: z.string().default("football"),
  lengthFt: z.number().int().min(1).max(10_000),
  widthFt: z.number().int().min(1).max(10_000),
  lineItems: z.array(lineItemSchema).min(1),
  notes: z.string().max(4000).optional(),
  // Customer-facing caption — sent as a text message BEFORE the PDF
  // during /send so WhatsApp displays it clearly.
  caption: z.string().max(1024).nullable().optional(),
  quoteDate: z.string().datetime(),
  validityDays: z.number().int().min(1).max(365).default(30),
  conversationId: z.string().uuid().nullable().optional(),
  contactPhone: z.string().min(5).max(30).nullable().optional(),
  // A quote belongs to the customer's contact (accountContactId, or resolved
  // from the conversation / phone). dealId only when the caller explicitly
  // quotes against an already-confirmed project — quotes never create deals,
  // deals are confirmed projects only.
  dealId: z.string().uuid().nullable().optional(),
  accountContactId: z.string().uuid().nullable().optional(),
  // Tier-1 classification — written to Deal.leadSourceId / Account.customerProfileId
  // / Account.businessType, which Team Performance's Sources and Customers
  // views read (previously always empty — see docs/DECISIONS.md).
  leadSourceId: z.string().uuid().nullable().optional(),
  customerProfileId: z.string().uuid().nullable().optional(),
  businessType: z.enum(["B2B", "B2C", "B2G"]).nullable().optional(),
  salespersonPhone: z.string().max(30).nullable().optional(),
  sections: z.string().max(100_000).refine((s) => { try { JSON.parse(s); return true; } catch { return false; } }, "sections must be valid JSON").optional(),
});

const listFilterSchema = z.object({
  status: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  search: z.string().optional(),
  createdByUserId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const filters = listFilterSchema.safeParse({
    status: sp.get("status") ?? undefined,
    fromDate: sp.get("fromDate") ?? undefined,
    toDate: sp.get("toDate") ?? undefined,
    search: sp.get("search") ?? undefined,
    createdByUserId: sp.get("createdByUserId") ?? undefined,
  });
  const f = filters.success ? filters.data : {};

  const where: Record<string, unknown> = {};
  if (f.status) where.status = f.status;
  if (f.createdByUserId) where.createdByUserId = f.createdByUserId;
  if (f.fromDate || f.toDate) {
    where.createdAt = {
      ...(f.fromDate && { gte: new Date(f.fromDate) }),
      ...(f.toDate && { lte: new Date(f.toDate) }),
    };
  }
  if (f.search) {
    const s = f.search.trim();
    where.OR = [
      { customerName: { contains: s, mode: "insensitive" } },
      { number: { contains: s, mode: "insensitive" } },
      { contactPhone: { contains: s } },
    ];
  }

  // Sales sees only their own; admin sees all.
  if (user.role !== "admin") {
    where.createdByUserId = user.id;
  }

  // Select only the columns the list needs — skips the large lineItems JSON
  // blob (~2-10 KB per row × 200 rows) for a much faster query + response.
  const items = await prisma.quotation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: QUOTATION_LIST_SELECT,
  });

  return NextResponse.json({
    quotations: items.map((q) => ({
      id: q.id,
      number: q.number,
      customerName: q.customerName,
      sport: q.sport,
      lengthFt: q.lengthFt,
      widthFt: q.widthFt,
      grandTotal: q.grandTotal.toString(),
      status: q.status,
      pdfUrl: q.pdfUrl,
      quoteDate: q.quoteDate.toISOString(),
      validityDays: q.validityDays,
      sentAt: q.sentAt?.toISOString() ?? null,
      contactPhone: q.contactPhone,
      conversationId: q.conversationId,
      createdByName: q.createdBy.name,
      createdAt: q.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  // Compute totals server-side from the line items (don't trust client math).
  const totals = recompute(parsed.data.lineItems as QuoteLineItem[]);
  const year = new Date(parsed.data.quoteDate).getFullYear();

  // Quotes attach to the customer's contact and never create a deal (deals
  // are confirmed projects only — see confirmDeal.ts). An explicit dealId is
  // kept for a quote against an already-confirmed project.
  const dealId = parsed.data.dealId ?? null;
  const resolved = await resolveContactForDocument(
    { accountContactId: parsed.data.accountContactId, conversationId: parsed.data.conversationId, contactPhone: parsed.data.contactPhone },
    user,
  );
  if (resolved?.explicit && !resolved.canEdit) {
    return NextResponse.json({ error: "You can't add a quotation to this customer" }, { status: 403 });
  }
  const accountContactId = resolved?.id ?? null;
  // Run independent writes in parallel: deal update, isPrimary demotion, sequence number lookup.
  const [dealAfterQuote, , nextSeqResult] = await Promise.all([
    dealId
      ? setDealQuotedValue({
          dealId,
          quotedValue: totals.grandTotal,
          siteCity: parsed.data.siteCity,
          leadSourceId: parsed.data.leadSourceId,
        })
      : Promise.resolve(null),
    dealId ? demotePrimaryQuotes(dealId) : Promise.resolve(null),
    nextSequenceForYear(year),
  ]);
  // What the wizard asked about the customer lands on the customer — only
  // when this user may change that customer.
  if (accountContactId && !dealId && resolved?.canEdit) {
    await applyDocumentClassification({
      contactId: accountContactId,
      siteCity: parsed.data.siteCity,
      leadSourceId: parsed.data.leadSourceId,
      customerProfileId: parsed.data.customerProfileId,
      businessType: parsed.data.businessType,
    });
  }

  // Conversation + Account syncs (depend on dealAfterQuote, but independent of each other).
  const sideEffects: Promise<unknown>[] = [];
  const conversationSync = syncConversationDealValue(dealAfterQuote);
  if (conversationSync) sideEffects.push(conversationSync);
  if (dealId) {
    const accountSync = syncDealAccountClassification({
      dealId,
      customerProfileId: parsed.data.customerProfileId,
      businessType: parsed.data.businessType,
    });
    if (accountSync) sideEffects.push(accountSync);
  }
  // Best-effort and not needed by the quote itself; kept alive after the
  // response (a bare floating promise can be cut off once the function returns).
  if (sideEffects.length) after(Promise.all(sideEffects));

  // Number assignment with the P2002 retry lives in lib/quotation/service.ts.
  const quotation = await createQuotationWithNumber({
    year,
    nextSeq: nextSeqResult,
    data: {
      customerName: parsed.data.customerName,
      sport: parsed.data.sport,
      lengthFt: parsed.data.lengthFt,
      widthFt: parsed.data.widthFt,
      lineItems: JSON.stringify(parsed.data.lineItems),
      subtotal: totals.subtotal,
      gstAmount: totals.gstAmount,
      grandTotal: totals.grandTotal,
      notes: parsed.data.notes ?? null,
      caption: parsed.data.caption ?? null,
      quoteDate: new Date(parsed.data.quoteDate),
      validityDays: parsed.data.validityDays,
      conversationId: parsed.data.conversationId ?? null,
      contactPhone: parsed.data.contactPhone ?? null,
      salespersonPhone: parsed.data.salespersonPhone ?? null,
      sections: parsed.data.sections ?? null,
      createdByUserId: user.id,
      status: "draft",
      dealId,
      accountContactId,
      isPrimary: true,
    },
  });

  if (!quotation) {
    // createQuotationWithNumber already logged the collision.
    return NextResponse.json(
      {
        error:
          "Could not assign a unique quote number after retries. Try again in a moment.",
      },
      { status: 503 }
    );
  }

  // DealLineItem rows for analytics. The quote's own JSON snapshot is already
  // saved; this best-effort write runs after the response so it never delays it.
  if (dealId) {
    after(() =>
      writeDealLineItems({
        dealId,
        quotationId: quotation.id,
        sport: parsed.data.sport,
        lineItems: parsed.data.lineItems as QuoteLineItem[],
      }),
    );
  }

  return NextResponse.json({
    quotation: {
      id: quotation.id,
      number: quotation.number,
      status: quotation.status,
      grandTotal: quotation.grandTotal.toString(),
    },
  });
}

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// Bulk delete — mirrors the single-item DELETE's admin-only rule exactly
// (src/app/api/quotations/[id]/route.ts).
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  // Collect affected deals BEFORE deleteMany (which doesn't return row data)
  // so each can be reconciled afterward — see docs/DECISIONS.md.
  const affected = await prisma.quotation.findMany({
    where: { id: { in: parsed.data.ids } },
    select: { number: true, dealId: true, accountContactId: true, contactPhone: true, createdAt: true },
  });
  const dealIds = [...new Set(affected.map((q) => q.dealId).filter((id): id is string => !!id))];

  const result = await prisma.quotation.deleteMany({
    where: { id: { in: parsed.data.ids } },
  });
  await Promise.all(dealIds.map((id) => reconcileDealAfterQuotationDelete(id)));
  await Promise.all(affected.map((q) => logDocumentDeleted({ kind: "quotation", ...q }, user.id)));
  return NextResponse.json({ ok: true, count: result.count });
}
