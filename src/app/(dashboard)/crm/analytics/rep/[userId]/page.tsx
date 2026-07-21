import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRepDeals } from "@/lib/analytics/repDeals";
import { stageVelocity } from "@/lib/analytics/timelines";
import RepDealsClient from "./RepDealsClient";

// CrmTabs is already rendered once by crm/layout.tsx, which wraps every
// /crm/* route including this one — don't render it again here.
export default async function RepDealsPage({
  params,
  searchParams,
}: {
  params: { userId: string };
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const rep = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true, name: true } });
  if (!rep) notFound();

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const fromStr = searchParams.from ?? defaultFrom.toISOString().slice(0, 10);
  const toStr = searchParams.to ?? new Date().toISOString().slice(0, 10);
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T23:59:59");

  // Same range used for stage velocity now also scopes the roster itself
  // (createdAt-filtered) — previously the roster ignored the date range
  // shown right next to it entirely, per explicit request to change that.
  const [deals, velocity] = await Promise.all([
    getRepDeals(rep.id, { from, to }),
    stageVelocity({ from, to, ownerIds: [rep.id] }),
  ]);

  return <RepDealsClient repName={rep.name} deals={deals} stageVelocity={velocity} dateRange={{ from: fromStr, to: toStr }} />;
}
