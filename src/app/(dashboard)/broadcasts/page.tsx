import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BroadcastsClient from "./BroadcastsClient";

export default async function BroadcastsPage() {
  const user = await requireUser();

  const where = user.role === "admin" ? {} : { createdByUserId: user.id };

  const broadcasts = await prisma.broadcast.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      template: { select: { name: true, language: true } },
      createdBy: { select: { name: true } },
    },
    take: 50,
  });

  const approvedTemplates = await prisma.template.findMany({
    where: { status: "approved" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, language: true, body: true },
  });

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
      }))}
      approvedTemplates={approvedTemplates}
    />
  );
}
