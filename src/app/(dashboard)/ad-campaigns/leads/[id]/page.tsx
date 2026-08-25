import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getMetaLeadDetail, getAssignableReps, getMetaLeadLabels } from "@/lib/meta-ads/queries";
import LeadDetailClient from "./LeadDetailClient";

// Detail view for one captured Meta Instant-Form lead, addressed by its INTERNAL
// MetaLead.id (params.id — NOT the raw Meta leadgen id). Open to all approved
// reps; requireUser redirects a logged-out visitor who reaches the URL directly.
// A static leads/ segment lives safely beside the dynamic [campaignId]/ route
// (the lead-analytics/ segment already coexists the same way). Loads the full
// lead-management payload (stage/assignee/reminder/labels/notes), the assignable
// reps (Move-to-CRM owner picker + the sidebar's assignee picker), and the label
// catalogue for the sidebar's label picker.

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const [lead, reps, labelCatalog] = await Promise.all([
    getMetaLeadDetail(params.id),
    getAssignableReps(),
    getMetaLeadLabels(),
  ]);

  if (!lead) notFound();

  return (
    <LeadDetailClient
      lead={lead}
      reps={reps}
      labelCatalog={labelCatalog}
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
    />
  );
}
