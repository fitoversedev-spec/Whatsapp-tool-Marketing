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
  const from = searchParams.from ? new Date(searchParams.from + "T00:00:00") : defaultFrom;
  const to = searchParams.to ? new Date(searchParams.to + "T23:59:59") : new Date();

  const [deals, velocity] = await Promise.all([
    getRepDeals(rep.id),
    stageVelocity({ from, to, ownerIds: [rep.id] }),
  ]);

  return <RepDealsClient repName={rep.name} deals={deals} stageVelocity={velocity} />;
}
