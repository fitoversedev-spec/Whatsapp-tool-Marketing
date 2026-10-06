import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BroadcastsClient from "./BroadcastsClient";

// Two tabs: Broadcasts (non-admins see their own) and Groups (shared by the
// whole team). ?tab=groups opens Groups; ?group=<id> opens the composer ready
// to send to that group (the group page's "Send broadcast" button).
export default async function BroadcastsPage({
  searchParams,
}: {
  searchParams: { tab?: string; group?: string };
}) {
  const user = await requireUser();

  const where = user.role === "admin" ? {} : { createdByUserId: user.id };

  // The broadcast list, the approved-template list and the groups are
  // independent, so fetch them concurrently rather than in a serial waterfall.
  const [broadcasts, approvedTemplates, groups] = await Promise.all([
    prisma.broadcast.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { name: true, language: true } },
        createdBy: { select: { name: true } },
      },
      take: 50,
    }),
    prisma.template.findMany({
      where: { status: "approved", deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, language: true, body: true },
    }),
    prisma.broadcastGroup.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { name: true } },
        _count: { select: { members: true } },
      },
    }),
  ]);

  const composeGroupId =
    searchParams.group && groups.some((g) => g.id === searchParams.group) ? searchParams.group : null;

  return (
    <BroadcastsClient
      broadcasts={broadcasts.map((b) => ({
        id: b.id,
        name: b.name,
        templateName: b.template.name,
        status: b.status,
        total: b.total,
        sent: b.sent,
        delivered: b.delivered,
        read: b.read,
        failed: b.failed,
        createdByName: b.createdBy.name,
        createdAt: b.createdAt.toISOString(),
        scheduledAt: b.scheduledAt?.toISOString() ?? null,
      }))}
      approvedTemplates={approvedTemplates}
      groups={groups.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g._count.members,
        createdByUserId: g.createdByUserId,
        createdByName: g.createdBy.name,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      }))}
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      initialTab={searchParams.tab === "groups" || composeGroupId ? "groups" : "broadcasts"}
      composeGroupId={composeGroupId}
    />
  );
}
