import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { type PipelineStage } from "@/lib/pipeline";
import { getPipelineStages } from "@/lib/pipeline-server";
import PipelineClient from "./PipelineClient";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { view?: string; owner?: string };
}) {
  const user = await requireUser();
  const stages = await getPipelineStages();
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

  const conversations = await prisma.conversation.findMany({
    where: ownerWhere,
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
  });

  const salesUsers =
    user.role === "admin"
      ? await prisma.user.findMany({
          where: { role: "sales", isActive: true, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  // Group conversations by stage. Any conversation with a stage not in the
  // configured list lands in "new" (graceful degradation if stages were
  // removed/renamed).
  const validStageIds = new Set(stages.map((s) => s.id));
  const cards = conversations.map((c) => {
    const lastMsg = c.messages[0];
    return {
      id: c.id,
      contactPhone: c.contactPhone,
      contactName: c.contactName,
      pipelineStage: validStageIds.has(c.pipelineStage ?? "")
        ? c.pipelineStage!
        : "new",
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
      currentUser={{ id: user.id, name: user.name, role: user.role as "admin" | "sales" }}
      initialStages={stages as PipelineStage[]}
      initialCards={cards}
      salesUsers={salesUsers}
      view={view}
      owner={ownerFilter}
    />
  );
}
