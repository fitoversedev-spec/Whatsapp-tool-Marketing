import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BroadcastsClient from "./BroadcastsClient";

export default async function BroadcastsPage() {
  const user = await requireUser();

  const where = user.role === "admin" ? {} : { createdByUserId: user.id };

  // The broadcast list and the approved-template list are independent, so
  // fetch them concurrently rather than in a serial waterfall.
  const [broadcasts, approvedTemplates] = await Promise.all([
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
  ]);

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
    />
  );
}
