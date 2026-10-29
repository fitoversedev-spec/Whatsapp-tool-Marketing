import { requireUser } from "@/lib/auth";
import { isAdmin, isManagerOrAbove } from "@/lib/rbac";
import { getAssignableReps, getMetaLeadLabels, getMetaLeadStages } from "@/lib/meta-ads/queries";
import { getInitialWebsiteLeadList, parseLeadRange } from "@/lib/website-leads/list";
import WebsiteLeadsClient from "./WebsiteLeadsClient";
import WebsiteAnalyticsPage from "./analytics/WebsiteAnalyticsPage";

// Leads from the "Build a court" form on fitoverse.com. Open to all approved
// reps (like the ad leads list); requireUser redirects a logged-out visitor who
// reaches the URL directly. The received-date range is driven by ?from/?to so
// the DateRangePicker can re-run this server fetch by pushing a new query
// string (blank = all time). The table then pages, filters and exports itself
// through /api/website-leads. ?tab=analytics shows the website analytics tab
// instead; it loads its own data, so none of the leads queries run for it.
export default async function WebsiteLeadsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; tab?: string };
}) {
  const user = await requireUser();
  if (searchParams.tab === "analytics") return <WebsiteAnalyticsPage />;
  const { from, to } = parseLeadRange(searchParams.from, searchParams.to);

  const [initial, reps, stageCatalog, labelCatalog] = await Promise.all([
    getInitialWebsiteLeadList({ from, to }),
    getAssignableReps(),
    getMetaLeadStages(),
    getMetaLeadLabels(), // for the side panel's label picker
  ]);

  return (
    <WebsiteLeadsClient
      initial={initial}
      reps={reps}
      stageCatalog={stageCatalog}
      labelCatalog={labelCatalog}
      currentUserId={user.id}
      canBulkAssign={isManagerOrAbove(user.role)}
      canRemove={isManagerOrAbove(user.role)}
      canDelete={isAdmin(user.role)}
      range={{ from: searchParams.from ?? "", to: searchParams.to ?? "" }}
    />
  );
}
