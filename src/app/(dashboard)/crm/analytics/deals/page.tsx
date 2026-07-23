import { requireAnalyticsAccess } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { getDealsDrilldown, type DealsDrilldownFilter } from "@/lib/analytics/dealsDrilldown";
import DealsDrilldownClient from "./DealsDrilldownClient";

// The one drill-to-deals destination every AnalyticsCard across every
// analytics group links to (see src/lib/analytics/dealsDrilldown.ts). Query
// params below are the load-bearing contract every future drillHref must
// match. CrmTabs is already rendered once by crm/layout.tsx, which wraps
// every /crm/* route including this one — don't render it again here.
type SearchParams = {
  productId?: string;
  sportId?: string;
  city?: string;
  customerProfileId?: string;
  stageId?: string;
  outcome?: string;
  from?: string;
  to?: string;
  // Admin-only: comma-separated user ids (max 2) to compare side by side. A
  // non-admin's value here is ignored entirely — resolveAnalyticsScope still
  // forces their own ownerIds, so this param can never widen their scope.
  reps?: string;
};

// "open" reads as null (deals not yet closed) — the one value not passed
// straight through, since a real outcome can never itself be the string
// "open". Anything else unrecognized is treated as "no filter" rather than
// silently matching nothing.
function parseOutcome(raw: string | undefined): DealsDrilldownFilter["outcome"] {
  if (raw === "WON" || raw === "LOST" || raw === "DROPPED") return raw;
  if (raw === "open") return null;
  return undefined;
}

export default async function DealsDrilldownPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAnalyticsAccess();
  const scope = resolveAnalyticsScope({ id: user.id, role: user.role as Role });
  const isAdmin = scope.companyWide;

  // The `reps` param is admin-only. For a non-admin scope.companyWide is
  // false, so selectedReps stays [] no matter what the client sent, and
  // ownerIds below falls back to scope.ownerIds ([self]) — the param is inert.
  const selectedReps = isAdmin
    ? (searchParams.reps ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 2)
    : [];

  const filter: DealsDrilldownFilter = {
    // A non-admin is ALWAYS forced to their own deals (scope.ownerIds). Only an
    // admin (companyWide) may widen scope, and only to the reps they explicitly
    // picked — absent a pick, admin stays company-wide (ownerIds undefined).
    ownerIds: isAdmin ? (selectedReps.length ? selectedReps : undefined) : scope.ownerIds,
    productId: searchParams.productId,
    sportId: searchParams.sportId,
    city: searchParams.city,
    customerProfileId: searchParams.customerProfileId,
    stageId: searchParams.stageId,
    outcome: parseOutcome(searchParams.outcome),
    from: searchParams.from ? new Date(searchParams.from + "T00:00:00") : undefined,
    to: searchParams.to ? new Date(searchParams.to + "T23:59:59") : undefined,
  };

  const deals = await getDealsDrilldown(filter);

  // Picker options — only an admin gets (and needs) the roster; a non-admin
  // never sees the rep-comparison UI, so we don't even query it for them.
  const users = isAdmin
    ? await prisma.user.findMany({
        where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true },
      })
    : [];

  return (
    <DealsDrilldownClient
      deals={deals}
      filters={searchParams}
      isAdmin={isAdmin}
      users={users}
      selectedReps={selectedReps}
    />
  );
}
