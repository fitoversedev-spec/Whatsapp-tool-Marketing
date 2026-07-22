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
  const ownerFilter = searchParams.owner ?? (user.role === "sales" ? "me" : "all");
  const ownerWhere =
    ownerFilter === "all"
      ? user.role === "admin"
        ? {}
        : { OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }] }
      : ownerFilter === "me"
        ? { assignedToUserId: user.id }
        : ownerFilter === "unassigned"
          ? { assignedToUserId: null }
          : { assignedToUserId: ownerFilter };

  // Stages, the conversation list, and the sales-user list are independent of
  // one another (their inputs are already derived from `user`), so run them
  // concurrently instead of as three serial round-trips.
  const [stages, conversations, salesUsers, lossReasons] = await Promise.all([
    getPipelineStages(),
    prisma.conversation.findMany({
      // Every conversation defaults to pipelineStage:"new" the moment it's
      // created (Conversation.pipelineStage's own schema default) — without
      // this, raw chats that were never actually worked into a deal showed
      // up on the board alongside real ones. Scoped to the same dealChannel
      // the rest of the CRM now uses (see docs/DECISIONS.md).
      where: { ...ownerWhere, deals: { some: { deletedAt: null, dealChannel: "crm" } } },
      include: {
        assignedTo: { select: { name: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, direction: true, createdAt: true },
        },
      },
      orderBy: [{ stageChangedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
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

  // Group conversations by stage. Any conversation with a stage not in the
  // configured list lands in the earliest active stage (graceful degradation
  // if stages were removed/renamed) — was a stale literal "new" here, which
  // stopped being a real FunnelStage slug once the vocabulary unification
  // (see docs/DECISIONS.md) renamed it to "enquiry_received"; an unrecognized
  // value would have silently vanished from every column instead of landing
  // somewhere visible. Mirrors PipelineClient.tsx's own fallbackStageId.
  const validStageIds = new Set(stages.map((s) => s.id));
  const fallbackStageId = stages[0]?.id ?? "enquiry_received";
  const cards = conversations.map((c) => {
    const lastMsg = c.messages[0];
    return {
      id: c.id,
      contactPhone: c.contactPhone,
      contactName: c.contactName,
      pipelineStage: validStageIds.has(c.pipelineStage ?? "")
        ? c.pipelineStage!
        : fallbackStageId,
      stageChangedAt: c.stageChangedAt?.toISOString() ?? null,
      dealValue: c.dealValue?.toString() ?? null,
      expectedCloseAt: c.expectedCloseAt?.toISOString() ?? null,
      lostReason: c.lostReason,
      assignedToName: c.assignedTo?.name ?? null,
      assignedToUserId: c.assignedToUserId,
      lastMessage: lastMsg
        ? {
            body: lastMsg.body?.slice(0, 120) ?? "",
            direction: lastMsg.direction,
            createdAt: lastMsg.createdAt.toISOString(),
          }
        : null,
      createdAt: c.createdAt.toISOString(),
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
