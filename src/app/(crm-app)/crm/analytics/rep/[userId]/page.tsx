import { notFound } from "next/navigation";
import { requireAnalyticsAccess } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
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
  const user = await requireAnalyticsAccess();
  // A non-admin can only ever drill into their OWN rep page — never someone
  // else's, no matter what userId is typed into the URL.
  if (!isAdmin(user.role) && params.userId !== user.id) notFound();

  const rep = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true, name: true } });
  if (!rep) notFound();

  // No pre-applied dates: when neither end is picked, query the ALL-TIME
  // window (2000-01-01..now) so the roster + velocity show everything,
  // but hand the picker BLANK strings so it renders empty (not a
  // fabricated range). A picked range narrows to exactly that range.
  const from = searchParams.from ? new Date(searchParams.from + "T00:00:00") : new Date("2000-01-01T00:00:00Z");
  const to = searchParams.to ? new Date(searchParams.to + "T23:59:59") : new Date();

  // Same range used for stage velocity now also scopes the roster itself
  // (createdAt-filtered) — previously the roster ignored the date range
  // shown right next to it entirely, per explicit request to change that.
  const [deals, velocity] = await Promise.all([
    getRepDeals(rep.id, { from, to }),
    stageVelocity({ from, to, ownerIds: [rep.id] }),
  ]);

  return (
    <RepDealsClient
      repName={rep.name}
      deals={deals}
      stageVelocity={velocity}
      dateRange={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
