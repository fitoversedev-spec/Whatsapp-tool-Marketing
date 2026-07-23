// Lead source analytics (spec §11.3.G). Leads/qualified come from the Lead
// table; quoted/won/value/cycle come from Deal.leadSourceId directly, since
// many deals are created straight in the CRM without a separate Lead row —
// mirrors how geography.ts/customers.ts group Deal rows by their own
// dimension rather than requiring a join. lead->won% is the one metric that
// genuinely needs to trace Lead.convertedDealId -> Deal.outcome.
//
// CAC/ROAS need ad spend, which nothing supplies yet (AdSpend ships empty —
// admin entry UI is a TODO, see docs/DATA_GAPS.md). Those columns render
// "—" per source rather than being hidden, per the spec's explicit instruction.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

export type SourceRow = {
  sourceName: string;
  leads: number;
  qualified: number;
  // Total deals attributed to this source (Deal.leadSourceId). Distinct from
  // `leads` (the separate Lead table, which is empty for CRM-native deals) —
  // this is the real per-source volume most deals actually have.
  deals: number;
  quoted: number;
  won: number;
  wonValue: number;
  leadToWonRate: number | null;
  avgCycleDays: number | null;
  adSpend: number | null;
  costPerLead: number | null;
  cac: number | null;
  roas: number | null;
};

export type SourceCityCell = { sourceName: string; city: string; enquiries: number };
export type SourceProductCell = { sourceName: string; productName: string; enquiries: number };

export async function sourceAnalytics(filter: AnalyticsFilter): Promise<{
  sources: SourceRow[];
  cityCrossTab: SourceCityCell[];
  productCrossTab: SourceProductCell[];
}> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const [sourceTaxonomy, leads, deals, closedDeals, adSpendRows, lineItems] = await Promise.all([
    prisma.leadSource.findMany({ select: { id: true, name: true } }),
    // Lead has no dealChannel concept — see salesActivity.ts's own comment
    // on why the general Lead table is already CRM-native by construction.
    prisma.lead.findMany({
      where: { createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere },
      select: { leadSourceId: true, status: true, convertedDealId: true },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: {
        leadSourceId: true,
        siteCity: true,
        outcome: true,
        wonValue: true,
        quotations: { select: { id: true }, where: { status: "sent" } },
      },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { leadSourceId: true, enquiryAt: true, closedAt: true },
    }),
    prisma.adSpend.findMany({ where: { month: { gte: filter.from, lte: filter.to } }, select: { leadSourceId: true, amount: true } }),
    prisma.dealLineItem.findMany({
      where: { deal: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere } },
      select: { product: { select: { name: true } }, label: true, deal: { select: { leadSourceId: true } } },
    }),
  ]);

  const convertedDealIds = leads.map((l) => l.convertedDealId).filter((id): id is string => !!id);
  const convertedDeals = convertedDealIds.length
    ? await prisma.deal.findMany({ where: { id: { in: convertedDealIds } }, select: { id: true, outcome: true } })
    : [];
  const outcomeByDealId = new Map(convertedDeals.map((d) => [d.id, d.outcome]));

  const sourceNameById = new Map(sourceTaxonomy.map((s) => [s.id, s.name]));
  const nameFor = (id: string | null) => (id ? sourceNameById.get(id) ?? "(unknown source)" : "(unspecified)");

  const leadMap = new Map<string, { leads: number; qualified: number; won: number }>();
  for (const l of leads) {
    const name = nameFor(l.leadSourceId);
    const e = leadMap.get(name) ?? { leads: 0, qualified: 0, won: 0 };
    e.leads += 1;
    if (l.status === "QUALIFIED") e.qualified += 1;
    if (l.convertedDealId && outcomeByDealId.get(l.convertedDealId) === "WON") e.won += 1;
    leadMap.set(name, e);
  }

  const dealMap = new Map<string, { deals: number; quoted: number; won: number; wonValue: number }>();
  const cityMap = new Map<string, Map<string, number>>();
  for (const d of deals) {
    const name = nameFor(d.leadSourceId);
    const e = dealMap.get(name) ?? { deals: 0, quoted: 0, won: 0, wonValue: 0 };
    e.deals += 1;
    if (d.quotations.length > 0) e.quoted += 1;
    if (d.outcome === "WON") {
      e.won += 1;
      e.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    dealMap.set(name, e);

    const city = d.siteCity?.trim() || "(unspecified)";
    const bySource = cityMap.get(name) ?? new Map<string, number>();
    bySource.set(city, (bySource.get(city) ?? 0) + 1);
    cityMap.set(name, bySource);
  }

  const cycleMap = new Map<string, { sum: number; n: number }>();
  for (const d of closedDeals) {
    if (!d.closedAt) continue;
    const name = nameFor(d.leadSourceId);
    const e = cycleMap.get(name) ?? { sum: 0, n: 0 };
    e.sum += (d.closedAt.getTime() - d.enquiryAt.getTime()) / 86_400_000;
    e.n += 1;
    cycleMap.set(name, e);
  }

  const adSpendMap = new Map<string, number>();
  for (const a of adSpendRows) {
    const name = nameFor(a.leadSourceId);
    adSpendMap.set(name, (adSpendMap.get(name) ?? 0) + Number(a.amount));
  }

  const productMap = new Map<string, Map<string, number>>();
  for (const li of lineItems) {
    const name = nameFor(li.deal.leadSourceId);
    const productName = li.product?.name ?? li.label ?? "(unspecified)";
    const bySource = productMap.get(name) ?? new Map<string, number>();
    bySource.set(productName, (bySource.get(productName) ?? 0) + 1);
    productMap.set(name, bySource);
  }

  const allNames = new Set<string>([...leadMap.keys(), ...dealMap.keys(), ...cycleMap.keys(), ...adSpendMap.keys()]);
  const sources: SourceRow[] = [...allNames]
    .map((sourceName) => {
      const l = leadMap.get(sourceName) ?? { leads: 0, qualified: 0, won: 0 };
      const d = dealMap.get(sourceName) ?? { deals: 0, quoted: 0, won: 0, wonValue: 0 };
      const cycle = cycleMap.get(sourceName);
      const spend = adSpendMap.get(sourceName) ?? null;
      return {
        sourceName,
        leads: l.leads,
        qualified: l.qualified,
        deals: d.deals,
        quoted: d.quoted,
        won: d.won,
        wonValue: d.wonValue,
        leadToWonRate: l.leads > 0 ? l.won / l.leads : null,
        avgCycleDays: cycle && cycle.n >= MIN_SAMPLE_SIZE ? cycle.sum / cycle.n : null,
        adSpend: spend,
        costPerLead: spend != null && l.leads > 0 ? spend / l.leads : null,
        cac: spend != null && d.won > 0 ? spend / d.won : null,
        roas: spend != null && spend > 0 ? d.wonValue / spend : null,
      };
    })
    .sort((a, b) => b.leads - a.leads);

  const cityCrossTab: SourceCityCell[] = [...cityMap.entries()].flatMap(([sourceName, byCity]) =>
    [...byCity.entries()].map(([city, enquiries]) => ({ sourceName, city, enquiries })),
  );
  const productCrossTab: SourceProductCell[] = [...productMap.entries()].flatMap(([sourceName, byProduct]) =>
    [...byProduct.entries()].map(([productName, enquiries]) => ({ sourceName, productName, enquiries })),
  );

  return { sources, cityCrossTab, productCrossTab };
}
