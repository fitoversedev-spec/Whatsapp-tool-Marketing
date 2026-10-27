import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isManagerOrAbove } from "@/lib/rbac";
import { getAssignableReps, getMetaLeadLabels, getMetaLeadStages } from "@/lib/meta-ads/queries";
import { getWebsiteLeadDetail } from "@/lib/website-leads/list";
import WebsiteLeadDetailClient from "./WebsiteLeadDetailClient";

// Detail view for one website lead, addressed by its INTERNAL WebsiteLead.id
// (params.id — not the website's own lead id). Open to all approved reps;
// requireUser redirects a logged-out visitor who reaches the URL directly.
// An admin or manager can also open a removed lead (to restore it); for anyone
// else it is a 404. Loads the full lead (every form answer, rep notes, labels, duplicate badges),
// the assignable reps (rep picker and Move-to-CRM owner), the label catalogue
// and the stage list.
export default async function WebsiteLeadDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const canRemove = isManagerOrAbove(user.role);

  const [lead, reps, labelCatalog, stageCatalog] = await Promise.all([
    getWebsiteLeadDetail(params.id, { includeRemoved: canRemove }),
    getAssignableReps(),
    getMetaLeadLabels(),
    getMetaLeadStages(),
  ]);

  if (!lead) notFound();

  return (
    <WebsiteLeadDetailClient
      lead={lead}
      reps={reps}
      labelCatalog={labelCatalog}
      stageCatalog={stageCatalog}
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      canRemove={canRemove}
    />
  );
}
