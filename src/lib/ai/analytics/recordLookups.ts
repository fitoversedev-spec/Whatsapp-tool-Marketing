// Record-lookup handlers for the analytics AI toolbox — the "find one specific
// record" counterpart to the aggregate analytics tools. Every handler applies
// the caller's owner scope EXACTLY like the aggregate tools do (resolveAnalytics
// Scope forces a non-admin to their own ownerIds), so a rep can only ever pull
// up records they own; an admin sees everyone. Records with no owner are never
// reachable by a scoped user. Name matching is fuzzy/typo-tolerant and case-
// insensitive; phone matching is normalized (digits only). Like every other
// tool, these return real DB rows verbatim — the model reports them, never
// invents.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AnalyticsScope } from "@/lib/analytics/scope";
import { fuzzyMatch, normalizePhone, phoneTail } from "@/lib/ai/fuzzy";

// Non-admin → the ids the caller is pinned to; admin/company-wide → undefined
// (no owner restriction).
function ownerScope(scope: AnalyticsScope): string[] | undefined {
  return scope.companyWide ? undefined : scope.ownerIds ?? [];
}

function num(v: Prisma.Decimal | null | undefined): number | null {
  return v == null ? null : Number(v);
}

function readQuery(input: Record<string, unknown>): string {
  return typeof input?.query === "string" ? input.query.trim() : "";
}

// Shared compact deal projection used by find_person / deal_detail lists.
const DEAL_CARD_SELECT = {
  code: true,
  title: true,
  outcome: true,
  estimatedValue: true,
  quotedValue: true,
  wonValue: true,
  siteCity: true,
  updatedAt: true,
  closedAt: true,
  currentStage: { select: { name: true, stageType: true } },
  owner: { select: { name: true } },
  activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { subject: true, notes: true, occurredAt: true } },
} satisfies Prisma.DealSelect;

type DealCard = Prisma.DealGetPayload<{ select: typeof DEAL_CARD_SELECT }>;

function dealCard(d: DealCard) {
  return {
    code: d.code,
    title: d.title,
    stage: d.currentStage.name,
    stageType: d.currentStage.stageType,
    outcome: d.outcome,
    owner: d.owner?.name ?? null,
    city: d.siteCity,
    value: num(d.wonValue ?? d.quotedValue ?? d.estimatedValue),
    estimatedValue: num(d.estimatedValue),
    quotedValue: num(d.quotedValue),
    wonValue: num(d.wonValue),
    lastActivity: d.activities[0]
      ? { subject: d.activities[0].subject, notes: d.activities[0].notes, at: d.activities[0].occurredAt.toISOString() }
      : null,
    closedAt: d.closedAt?.toISOString() ?? null,
    updatedAt: d.updatedAt.toISOString(),
  };
}

// ── find_person ──────────────────────────────────────────────────────────────
export async function findPerson(scope: AnalyticsScope, input: Record<string, unknown>): Promise<unknown> {
  const q = readQuery(input);
  if (!q) return { error: "Provide a name, phone, or email to look up." };
  const ownerIds = ownerScope(scope);

  const tail = phoneTail(q);
  const looksPhone = normalizePhone(q).length >= 5;

  // Owner-scope guards. A contact/account is "owned" if the account owner is the
  // rep OR the rep owns a deal on it; a lead by its own owner.
  const contactScope: Prisma.AccountContactWhereInput = ownerIds
    ? {
        OR: [
          { account: { ownerUserId: { in: ownerIds } } },
          { dealsAsPrimary: { some: { ownerUserId: { in: ownerIds }, deletedAt: null } } },
        ],
      }
    : {};
  const leadScope: Prisma.LeadWhereInput = ownerIds ? { ownerUserId: { in: ownerIds } } : {};
  const accountScope: Prisma.AccountWhereInput = ownerIds
    ? { OR: [{ ownerUserId: { in: ownerIds } }, { deals: { some: { ownerUserId: { in: ownerIds }, deletedAt: null } } }] }
    : {};

  const contactOr: Prisma.AccountContactWhereInput[] = [
    { name: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } },
  ];
  if (looksPhone) contactOr.push({ phone: { contains: tail } });
  const leadOr: Prisma.LeadWhereInput[] = [
    { name: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } },
  ];
  if (looksPhone) leadOr.push({ phone: { contains: tail } });
  const accountOr: Prisma.AccountWhereInput[] = [{ name: { contains: q, mode: "insensitive" } }];

  // Deals nested under a person are ALSO owner-scoped for a rep, so another
  // rep's deal on a shared account is never exposed.
  const dealsWhere: Prisma.DealWhereInput = { deletedAt: null, ...(ownerIds ? { ownerUserId: { in: ownerIds } } : {}) };

  async function load(
    contactWhere: Prisma.AccountContactWhereInput,
    leadWhere: Prisma.LeadWhereInput,
    accountWhere: Prisma.AccountWhereInput,
  ) {
    return Promise.all([
      prisma.accountContact.findMany({
        where: contactWhere,
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          phone: true,
          email: true,
          designation: true,
          account: { select: { name: true, businessType: true, city: true, owner: { select: { name: true } } } },
          dealsAsPrimary: { where: dealsWhere, orderBy: { updatedAt: "desc" }, take: 20, select: DEAL_CARD_SELECT },
          reminders: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { message: true, dueAt: true } },
          generalNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
        },
      }),
      prisma.lead.findMany({
        where: leadWhere,
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          phone: true,
          email: true,
          city: true,
          status: true,
          createdAt: true,
          leadSource: { select: { name: true } },
          owner: { select: { name: true } },
          convertedDeal: { select: DEAL_CARD_SELECT },
        },
      }),
      prisma.account.findMany({
        where: accountWhere,
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          businessType: true,
          city: true,
          gstin: true,
          owner: { select: { name: true } },
          contacts: { where: { deletedAt: null }, take: 20, select: { name: true, phone: true, isPrimary: true } },
          deals: { where: dealsWhere, orderBy: { updatedAt: "desc" }, take: 20, select: DEAL_CARD_SELECT },
        },
      }),
    ]);
  }

  let [contacts, leads, accounts] = await load(
    { deletedAt: null, AND: [contactScope, { OR: contactOr }] },
    { AND: [leadScope, { OR: leadOr }] },
    { deletedAt: null, AND: [accountScope, { OR: accountOr }] },
  );

  // Typo/case fallback on names, within the same owner scope.
  if (contacts.length === 0 && leads.length === 0 && accounts.length === 0) {
    const [cCand, lCand, aCand] = await Promise.all([
      prisma.accountContact.findMany({ where: { deletedAt: null, AND: [contactScope] }, take: 3000, select: { id: true, name: true } }),
      prisma.lead.findMany({ where: { AND: [leadScope] }, take: 3000, select: { id: true, name: true } }),
      prisma.account.findMany({ where: { deletedAt: null, AND: [accountScope] }, take: 3000, select: { id: true, name: true } }),
    ]);
    const cIds = fuzzyMatch(q, cCand, (x) => x.name).map((x) => x.id);
    const lIds = fuzzyMatch(q, lCand, (x) => x.name).map((x) => x.id);
    const aIds = fuzzyMatch(q, aCand, (x) => x.name).map((x) => x.id);
    if (cIds.length || lIds.length || aIds.length) {
      [contacts, leads, accounts] = await load(
        { deletedAt: null, AND: [contactScope, { id: { in: cIds } }] },
        { AND: [leadScope, { id: { in: lIds } }] },
        { deletedAt: null, AND: [accountScope, { id: { in: aIds } }] },
      );
    }
  }

  const matches = [
    ...contacts.map((c) => ({
      type: "contact" as const,
      name: c.name,
      phone: c.phone,
      email: c.email,
      designation: c.designation,
      account: c.account?.name ?? null,
      businessType: c.account?.businessType ?? null,
      city: c.account?.city ?? null,
      owner: c.account?.owner?.name ?? null,
      deals: c.dealsAsPrimary.map(dealCard),
      nextTask: c.reminders[0] ? { message: c.reminders[0].message, dueAt: c.reminders[0].dueAt.toISOString() } : null,
      lastNote: c.generalNotes[0] ? { body: c.generalNotes[0].body, at: c.generalNotes[0].createdAt.toISOString() } : null,
    })),
    ...leads.map((l) => ({
      type: "lead" as const,
      name: l.name,
      phone: l.phone,
      email: l.email,
      city: l.city,
      status: l.status,
      source: l.leadSource?.name ?? null,
      owner: l.owner?.name ?? null,
      createdAt: l.createdAt.toISOString(),
      deals: l.convertedDeal ? [dealCard(l.convertedDeal)] : [],
    })),
    ...accounts.map((a) => ({
      type: "account" as const,
      name: a.name,
      businessType: a.businessType,
      city: a.city,
      gstin: a.gstin,
      owner: a.owner?.name ?? null,
      contacts: a.contacts.map((cc) => ({ name: cc.name, phone: cc.phone, isPrimary: cc.isPrimary })),
      deals: a.deals.map(dealCard),
    })),
  ];

  return { query: q, count: matches.length, matches };
}

// ── deal_detail ──────────────────────────────────────────────────────────────
const DEAL_DETAIL_SELECT = {
  code: true,
  title: true,
  outcome: true,
  estimatedValue: true,
  quotedValue: true,
  wonValue: true,
  siteCity: true,
  siteState: true,
  enquiryAt: true,
  firstQuotedAt: true,
  closedAt: true,
  expectedCloseAt: true,
  updatedAt: true,
  lossReasonNote: true,
  nextActionNote: true,
  nextActionDueAt: true,
  currentStage: { select: { name: true, stageType: true } },
  owner: { select: { name: true } },
  account: { select: { name: true, businessType: true, city: true } },
  primaryContact: { select: { name: true, phone: true, email: true } },
  leadSource: { select: { name: true } },
  lossReason: { select: { name: true } },
  stageHistory: { orderBy: { changedAt: "asc" }, take: 30, select: { changedAt: true, note: true, toStage: { select: { name: true } } } },
  quotations: { orderBy: { createdAt: "desc" }, take: 10, select: { number: true, status: true, sport: true, grandTotal: true, quoteDate: true } },
  invoices: { orderBy: { createdAt: "desc" }, take: 10, select: { number: true, status: true, grandTotal: true, amountPaid: true, dueDate: true } },
  activities: { orderBy: { occurredAt: "desc" }, take: 5, select: { subject: true, notes: true, occurredAt: true } },
} satisfies Prisma.DealSelect;

type DealDetailRow = Prisma.DealGetPayload<{ select: typeof DEAL_DETAIL_SELECT }>;

function dealDetailRow(d: DealDetailRow) {
  return {
    code: d.code,
    title: d.title,
    stage: d.currentStage.name,
    stageType: d.currentStage.stageType,
    outcome: d.outcome,
    lossReason: d.lossReason?.name ?? d.lossReasonNote ?? null,
    owner: d.owner?.name ?? null,
    account: d.account?.name ?? null,
    businessType: d.account?.businessType ?? null,
    contact: d.primaryContact ? { name: d.primaryContact.name, phone: d.primaryContact.phone, email: d.primaryContact.email } : null,
    city: d.siteCity ?? d.account?.city ?? null,
    state: d.siteState,
    source: d.leadSource?.name ?? null,
    estimatedValue: num(d.estimatedValue),
    quotedValue: num(d.quotedValue),
    wonValue: num(d.wonValue),
    nextAction: d.nextActionNote ? { note: d.nextActionNote, dueAt: d.nextActionDueAt?.toISOString() ?? null } : null,
    enquiryAt: d.enquiryAt.toISOString(),
    firstQuotedAt: d.firstQuotedAt?.toISOString() ?? null,
    closedAt: d.closedAt?.toISOString() ?? null,
    expectedCloseAt: d.expectedCloseAt?.toISOString() ?? null,
    timeline: d.stageHistory.map((h) => ({ stage: h.toStage.name, at: h.changedAt.toISOString(), note: h.note })),
    quotations: d.quotations.map((qt) => ({
      number: qt.number,
      status: qt.status,
      sport: qt.sport,
      grandTotal: num(qt.grandTotal),
      quoteDate: qt.quoteDate.toISOString(),
    })),
    invoices: d.invoices.map((iv) => ({
      number: iv.number,
      status: iv.status,
      grandTotal: num(iv.grandTotal),
      amountPaid: num(iv.amountPaid),
      outstanding: iv.grandTotal != null ? Number(iv.grandTotal) - Number(iv.amountPaid ?? 0) : null,
      dueDate: iv.dueDate.toISOString(),
    })),
    recentActivity: d.activities.map((a) => ({ subject: a.subject, notes: a.notes, at: a.occurredAt.toISOString() })),
  };
}

export async function dealDetail(scope: AnalyticsScope, input: Record<string, unknown>): Promise<unknown> {
  const q = readQuery(input);
  if (!q) return { error: "Provide a deal code, title, or customer name to look up." };
  const ownerIds = ownerScope(scope);
  const scopeWhere: Prisma.DealWhereInput = ownerIds ? { ownerUserId: { in: ownerIds } } : {};

  const or: Prisma.DealWhereInput[] = [
    { code: { contains: q, mode: "insensitive" } },
    { title: { contains: q, mode: "insensitive" } },
    { account: { name: { contains: q, mode: "insensitive" } } },
    { primaryContact: { name: { contains: q, mode: "insensitive" } } },
  ];

  let deals = await prisma.deal.findMany({
    where: { deletedAt: null, AND: [scopeWhere, { OR: or }] },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: DEAL_DETAIL_SELECT,
  });

  if (deals.length === 0) {
    const cand = await prisma.deal.findMany({
      where: { deletedAt: null, AND: [scopeWhere] },
      take: 4000,
      select: { id: true, code: true, title: true, account: { select: { name: true } }, primaryContact: { select: { name: true } } },
    });
    const ids = fuzzyMatch(q, cand, (d) => `${d.code} ${d.title} ${d.account?.name ?? ""} ${d.primaryContact?.name ?? ""}`).map((d) => d.id);
    if (ids.length > 0) {
      deals = await prisma.deal.findMany({
        where: { deletedAt: null, AND: [scopeWhere, { id: { in: ids } }] },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: DEAL_DETAIL_SELECT,
      });
    }
  }

  const matches = deals.map(dealDetailRow);
  return { query: q, count: matches.length, matches };
}

// ── quotation_lookup ─────────────────────────────────────────────────────────
export async function quotationLookup(scope: AnalyticsScope, input: Record<string, unknown>): Promise<unknown> {
  const q = readQuery(input);
  if (!q) return { error: "Provide a quotation number or customer name to look up." };
  const ownerIds = ownerScope(scope);
  const scopeWhere: Prisma.QuotationWhereInput = ownerIds
    ? { OR: [{ createdByUserId: { in: ownerIds } }, { deal: { ownerUserId: { in: ownerIds } } }] }
    : {};

  const or: Prisma.QuotationWhereInput[] = [
    { number: { contains: q, mode: "insensitive" } },
    { customerName: { contains: q, mode: "insensitive" } },
  ];

  const select = {
    number: true,
    customerName: true,
    sport: true,
    status: true,
    quoteDate: true,
    validityDays: true,
    subtotal: true,
    gstAmount: true,
    grandTotal: true,
    sentAt: true,
    deal: { select: { code: true, owner: { select: { name: true } } } },
  } satisfies Prisma.QuotationSelect;

  let rows = await prisma.quotation.findMany({
    where: { AND: [scopeWhere, { OR: or }] },
    orderBy: { createdAt: "desc" },
    take: 15,
    select,
  });

  if (rows.length === 0) {
    const cand = await prisma.quotation.findMany({
      where: { AND: [scopeWhere] },
      take: 4000,
      select: { id: true, number: true, customerName: true },
    });
    const ids = fuzzyMatch(q, cand, (r) => `${r.number} ${r.customerName}`).map((r) => r.id);
    if (ids.length > 0) {
      rows = await prisma.quotation.findMany({
        where: { AND: [scopeWhere, { id: { in: ids } }] },
        orderBy: { createdAt: "desc" },
        take: 15,
        select,
      });
    }
  }

  const matches = rows.map((r) => ({
    number: r.number,
    customer: r.customerName,
    sport: r.sport,
    status: r.status,
    quoteDate: r.quoteDate.toISOString(),
    validityDays: r.validityDays,
    subtotal: num(r.subtotal),
    gst: num(r.gstAmount),
    grandTotal: num(r.grandTotal),
    sentAt: r.sentAt?.toISOString() ?? null,
    dealCode: r.deal?.code ?? null,
    owner: r.deal?.owner?.name ?? null,
  }));
  return { query: q, count: matches.length, matches };
}

// ── invoice_lookup ───────────────────────────────────────────────────────────
export async function invoiceLookup(scope: AnalyticsScope, input: Record<string, unknown>): Promise<unknown> {
  const q = readQuery(input);
  if (!q) return { error: "Provide an invoice number or customer name to look up." };
  const ownerIds = ownerScope(scope);
  const scopeWhere: Prisma.InvoiceWhereInput = ownerIds
    ? { OR: [{ createdByUserId: { in: ownerIds } }, { deal: { ownerUserId: { in: ownerIds } } }] }
    : {};

  const or: Prisma.InvoiceWhereInput[] = [
    { number: { contains: q, mode: "insensitive" } },
    { customerName: { contains: q, mode: "insensitive" } },
  ];

  const select = {
    number: true,
    customerName: true,
    sport: true,
    status: true,
    invoiceDate: true,
    dueDate: true,
    subtotal: true,
    gstAmount: true,
    grandTotal: true,
    amountPaid: true,
    paidAt: true,
    deal: { select: { code: true, owner: { select: { name: true } } } },
  } satisfies Prisma.InvoiceSelect;

  let rows = await prisma.invoice.findMany({
    where: { AND: [scopeWhere, { OR: or }] },
    orderBy: { createdAt: "desc" },
    take: 15,
    select,
  });

  if (rows.length === 0) {
    const cand = await prisma.invoice.findMany({
      where: { AND: [scopeWhere] },
      take: 4000,
      select: { id: true, number: true, customerName: true },
    });
    const ids = fuzzyMatch(q, cand, (r) => `${r.number} ${r.customerName}`).map((r) => r.id);
    if (ids.length > 0) {
      rows = await prisma.invoice.findMany({
        where: { AND: [scopeWhere, { id: { in: ids } }] },
        orderBy: { createdAt: "desc" },
        take: 15,
        select,
      });
    }
  }

  const matches = rows.map((r) => {
    const grand = Number(r.grandTotal);
    const paid = Number(r.amountPaid ?? 0);
    return {
      number: r.number,
      customer: r.customerName,
      sport: r.sport,
      status: r.status,
      invoiceDate: r.invoiceDate.toISOString(),
      dueDate: r.dueDate.toISOString(),
      subtotal: num(r.subtotal),
      gst: num(r.gstAmount),
      grandTotal: num(r.grandTotal),
      amountPaid: num(r.amountPaid),
      outstanding: Number.isFinite(grand) ? grand - paid : null,
      paidAt: r.paidAt?.toISOString() ?? null,
      dealCode: r.deal?.code ?? null,
      owner: r.deal?.owner?.name ?? null,
    };
  });
  return { query: q, count: matches.length, matches };
}
