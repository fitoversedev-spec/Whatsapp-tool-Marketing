import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeAllCustomers, customerAccess } from "@/lib/rbac";
import { listLeadStages } from "@/lib/crm/leadStages";
import LeadsPipelineClient from "./LeadsPipelineClient";

// The Pipeline board shows LEADS in their sales stages (Lead Generation →
// Post-Sales Analysis). Deals are confirmed projects only, so they no longer
// move through a pipeline — they live on the Deals page.
// The board loads at most this many leads (newest first); beyond that the
// header says how many are hidden.
const LIMIT = 1000;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { view?: string; owner?: string };
}) {
  const user = await requireUser();
  const view = searchParams.view === "funnel" ? "funnel" : "kanban";
  const seesAll = canSeeAllCustomers(user.role);

  // Owner filter — "me" / "all" / "unassigned" / a specific rep id. A
  // specific rep is only honoured for roles that see every rep's customers.
  const ownerFilter = searchParams.owner ?? (user.role === "sales" ? "me" : "all");
  const ownerWhere =
    ownerFilter === "all"
      ? seesAll ? {} : { OR: [{ ownerUserId: user.id }, { ownerUserId: null }] }
      : ownerFilter === "me"
        ? { ownerUserId: user.id }
        : ownerFilter === "unassigned"
          ? { ownerUserId: null }
          : seesAll || ownerFilter === user.id
            ? { ownerUserId: ownerFilter }
            : { ownerUserId: user.id };

  const leadsWhere = { deletedAt: null, pipelineStage: "LEAD", account: ownerWhere };
  const [stages, leads, total, reps] = await Promise.all([
    listLeadStages(),
    prisma.accountContact.findMany({
      where: leadsWhere,
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: {
        id: true, name: true, phone: true, leadStageId: true, createdAt: true, promotedToLeadAt: true,
        account: { select: { name: true, city: true, ownerUserId: true, owner: { select: { name: true } } } },
      },
    }),
    prisma.accountContact.count({ where: leadsWhere }),
    seesAll
      ? prisma.user.findMany({
          where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return (
    <LeadsPipelineClient
      view={view}
      owner={ownerFilter}
      total={total}
      reps={reps}
      stages={stages}
      cards={leads.map((l) => ({
        id: l.id,
        name: l.name.trim(),
        phone: l.phone,
        company: l.account.name.trim(),
        city: l.account.city,
        rep: l.account.owner?.name?.trim() ?? null,
        stageId: l.leadStageId,
        // Days as a lead (the card's "12d").
        createdAt: (l.promotedToLeadAt ?? l.createdAt).toISOString(),
        canEdit: customerAccess(user, l.account.ownerUserId).canEdit,
      }))}
    />
  );
}
