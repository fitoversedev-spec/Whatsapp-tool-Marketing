import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getMetaLeadById, getAssignableReps } from "@/lib/meta-ads/queries";
import LeadDetailClient from "./LeadDetailClient";

// Detail view for one captured Meta Instant-Form lead, addressed by its INTERNAL
// MetaLead.id (params.id — NOT the raw Meta leadgen id). Open to all approved
// reps; requireUser redirects a logged-out visitor who reaches the URL directly.
// A static leads/ segment lives safely beside the dynamic [campaignId]/ route
// (the lead-analytics/ segment already coexists the same way). Mirrors the
// campaign detail page: await requireUser, load the record, notFound() if null,
// and fetch the assignable reps for the Move-to-CRM owner picker.

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  await requireUser();

  const [lead, reps] = await Promise.all([getMetaLeadById(params.id), getAssignableReps()]);

  if (!lead) notFound();

  return <LeadDetailClient lead={lead} reps={reps} />;
}
