import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { type PipelineStage } from "@/lib/pipeline";
import { getPipelineStages } from "@/lib/pipeline-server";
import PipelineClient from "./PipelineClient";
import type { Role } from "@/lib/rbac";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { view?: string; owner?: string };
}) {
  const user = await requireUser();
  const view = searchParams.view === "funnel" ? "funnel" : "kanban";

  // Owner filter — "me" / "all" / specific userId. Sales defaults to "me".
  // Keyed on Deal.ownerUserId now (was Conversation.assignedToUserId before
  // this board became Deal-centric — see docs/DECISIONS.md).
  const ownerFilter = searchParams.owner ?? (user.role === "sales" ? "me" : "all");
  const ownerWhere =
    ownerFilter === "all"
      ? user.role === "admin"
        ? {}
        : { OR: [{ ownerUserId: user.id }, { ownerUserId: null }] }
      : ownerFilter === "me"
        ? { ownerUserId: user.id }
        : ownerFilter === "unassigned"
          ? { ownerUserId: null }
          : { ownerUserId: ownerFilter };

  // Stages, the deal list, and the sales-user list are independent of one
  // another, so run them concurrently instead of as three serial round-trips.
  const [stages, deals, salesUsers, lossReasons] = await Promise.all([
    getPipelineStages(),
    prisma.deal.findMany({
      // Pipeline used to be a straight Conversation query — every
      // conversation defaults to pipelineStage:"new" on creation, so it
      // showed every WhatsApp thread regardless of whether it was ever
      // actually worked into a deal, AND it could never show a deal created
      // directly in the CRM with no underlying conversation at all (most of
      // them, now that "Move to CRM" is the intended flow). Deal-centric
      // fixes both — see docs/DECISIONS.md.
      where: { deletedAt: null, dealChannel: "crm", ...ownerWhere },
      include: {
        account: { select: { name: true } },
        primaryContact: { select: { name: true, phone: true } },
        currentStage: { select: { slug: true } },
        owner: { select: { id: true, name: true } },
        conversation: {
          select: {
            id: true,
            contactPhone: true,
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { body: true, direction: true, createdAt: true },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
    }),
    user.role === "admin"
      ? prisma.user.findMany({
          where: { role: "sales", isActive: true, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    prisma.lossReason.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  // Group deals by stage. Any deal whose current stage isn't in the
  // configured active list (deactivated stage) lands in the earliest active
  // stage — graceful degradation, same reasoning PipelineClient.tsx's own
  // fallbackStageId already documents.
  const validStageIds = new Set(stages.map((s) => s.id));
  const fallbackStageId = stages[0]?.id ?? "enquiry_received";
  const cards = deals.map((d) => {
    const lastMsg = d.conversation?.messages[0];
    return {
      id: d.id,
      dealCode: d.code,
      contactName: d.primaryContact?.name ?? d.account.name,
      contactPhone: d.primaryContact?.phone ?? d.conversation?.contactPhone ?? null,
      pipelineStage: validStageIds.has(d.currentStage.slug) ? d.currentStage.slug : fallbackStageId,
      // Deal has no dedicated stageChangedAt field (see transitionDeal.ts's
      // own "best-effort: no separate stageChangedAt on Deal today" note) —
      // same approximation used there.
      stageChangedAt: d.updatedAt.toISOString(),
      // Most-concrete-figure-wins — same precedence transitionDeal.ts's own
      // Conversation write-through already uses.
      dealValue: (d.wonValue ?? d.quotedValue ?? d.estimatedValue)?.toString() ?? null,
      expectedCloseAt: d.expectedCloseAt?.toISOString() ?? null,
      lostReason: d.lossReasonNote,
      assignedToName: d.owner?.name ?? null,
      assignedToUserId: d.ownerUserId,
      lastMessage: lastMsg
        ? {
            body: lastMsg.body?.slice(0, 120) ?? "",
            direction: lastMsg.direction,
            createdAt: lastMsg.createdAt.toISOString(),
          }
        : null,
      // Present only when this deal actually has a WhatsApp thread behind
      // it — gates whether clicking the card opens the (conversation-only)
      // detail drawer or navigates straight to the Deal page instead.
      conversationId: d.conversationId,
      createdAt: d.createdAt.toISOString(),
    };
  });

  return (
    <PipelineClient
      currentUser={{ id: user.id, name: user.name, role: user.role as Role }}
      initialStages={stages as PipelineStage[]}
      initialCards={cards}
      salesUsers={salesUsers}
      lossReasons={lossReasons.map((l) => ({ id: l.id, name: l.name }))}
      view={view}
      owner={ownerFilter}
    />
  );
}
