import type { Prisma } from "@prisma/client";
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { listLeadStages } from "@/lib/crm/leadStages";
import { AgentHttpError } from "../errors";
import type { DealRow, DealsInput, dealDetailSchema } from "../schemas/read";
import { buildLeadWhere, searchLeads } from "./leads";
import { escapeLike, istDayEnd, istDayStart, requireId, toIso, toNumber } from "./shared";

/**
 * Deals are confirmed (won) projects. Read-only, summary fields only: the rep
 * is named (a salesperson needs to know who to hand over to), but no owner ids,
 * invoices, or cost figures are returned.
 */

export type DealRowSource = {
  id: string;
  code: string;
  title: string;
  wonValue: { toString(): string } | null;
  quotedValue: { toString(): string } | null;
  closedAt: Date | null;
  expectedStartAt: Date | null;
  executionStatus: string | null;
  account: { name: string; city: string | null };
  primaryContact: { id: string; name: string; deletedAt: Date | null } | null;
  owner: { name: string } | null;
};

export function toDealRow(d: DealRowSource): DealRow {
  const contact = d.primaryContact && !d.primaryContact.deletedAt ? d.primaryContact : null;
  return {
    id: d.id,
    code: d.code,
    title: d.title,
    customerName: (contact?.name ?? d.account.name).trim(),
    company: d.account.name.trim(),
    city: d.account.city,
    valueInr: toNumber(d.wonValue) ?? toNumber(d.quotedValue),
    wonAt: toIso(d.closedAt),
    expectedStartAt: toIso(d.expectedStartAt),
    executionStatus: d.executionStatus,
    rep: d.owner?.name?.trim() || null,
  };
}

const DEAL_ROW_SELECT = {
  id: true,
  code: true,
  title: true,
  wonValue: true,
  quotedValue: true,
  closedAt: true,
  expectedStartAt: true,
  executionStatus: true,
  account: { select: { name: true, city: true } },
  primaryContact: { select: { id: true, name: true, deletedAt: true } },
  owner: { select: { name: true } },
} satisfies Prisma.DealSelect;

export async function listDeals(input: Pick<DealsInput, "q" | "from" | "to" | "limit" | "cursor">) {
  const and: Prisma.DealWhereInput[] = [{ deletedAt: null, outcome: "WON" }];
  if (input.from) and.push({ closedAt: { gte: istDayStart(input.from) } });
  if (input.to) and.push({ closedAt: { lte: istDayEnd(input.to) } });
  if (input.q) {
    const like = escapeLike(input.q);
    and.push({
      OR: [
        { title: { contains: like, mode: "insensitive" } },
        { code: { contains: like, mode: "insensitive" } },
        { account: { name: { contains: like, mode: "insensitive" } } },
        { primaryContact: { name: { contains: like, mode: "insensitive" } } },
      ],
    });
  }
  const rows = await prisma.deal.findMany({
    where: { AND: and },
    orderBy: [{ closedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: DEAL_ROW_SELECT,
  });
  const page = rows.slice(0, input.limit);
  return { items: page.map(toDealRow), nextCursor: rows.length > input.limit ? page[page.length - 1].id : null };
}

export async function getDeal(rawId: string | undefined): Promise<z.infer<typeof dealDetailSchema>> {
  const id = requireId(rawId, "Deal");
  const d = await prisma.deal.findFirst({
    where: { id, deletedAt: null, outcome: "WON" },
    select: {
      ...DEAL_ROW_SELECT,
      wonNote: true,
      siteCity: true,
      siteState: true,
      currentStage: { select: { name: true } },
      stageHistory: {
        orderBy: { changedAt: "asc" },
        take: 50,
        select: { changedAt: true, fromStage: { select: { name: true } }, toStage: { select: { name: true } } },
      },
      lineItems: {
        orderBy: { createdAt: "asc" },
        take: 50,
        select: {
          id: true,
          label: true,
          quantity: true,
          unit: true,
          rate: true,
          amount: true,
          isEnquiryOnly: true,
          product: { select: { name: true } },
          sport: { select: { name: true } },
        },
      },
      quotations: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, number: true, grandTotal: true, status: true, sentAt: true },
      },
    },
  });
  if (!d) throw new AgentHttpError("not_found", "Deal not found.");
  const contact = d.primaryContact && !d.primaryContact.deletedAt ? d.primaryContact : null;
  return {
    ...toDealRow(d),
    customerId: contact?.id ?? null,
    note: d.wonNote,
    siteCity: d.siteCity,
    siteState: d.siteState,
    stage: d.currentStage.name,
    stageHistory: d.stageHistory.map((h) => ({ from: h.fromStage?.name ?? null, to: h.toStage.name, at: h.changedAt.toISOString() })),
    lineItems: d.lineItems.map((l) => ({
      id: l.id,
      name: l.product?.name ?? l.label ?? "Item",
      sport: l.sport?.name ?? null,
      quantity: Number(l.quantity.toString()),
      unit: l.unit,
      rateInr: toNumber(l.rate),
      amountInr: toNumber(l.amount),
      enquiryOnly: l.isEnquiryOnly,
    })),
    quotes: d.quotations.map((q) => ({
      id: q.id,
      number: q.number,
      totalInr: Number(q.grandTotal.toString()),
      status: q.status,
      sentAt: toIso(q.sentAt),
    })),
  };
}

// ---- pipeline -------------------------------------------------------------

export async function getPipeline(input: { stageId?: string; limit: number; cursor?: string }) {
  const base = await buildLeadWhere({});
  const [stages, groups, totalLeads, page] = await Promise.all([
    listLeadStages(),
    prisma.accountContact.groupBy({ by: ["leadStageId"], where: base, _count: { _all: true } }),
    prisma.accountContact.count({ where: base }),
    searchLeads({ stageId: input.stageId, limit: input.limit, cursor: input.cursor }),
  ]);
  const counts = new Map(groups.map((g) => [g.leadStageId, g._count._all]));
  return {
    stages: stages.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive, count: counts.get(s.id) ?? 0 })),
    unstagedCount: counts.get(null) ?? 0,
    totalLeads,
    leads: page.items,
    nextCursor: page.nextCursor,
  };
}
