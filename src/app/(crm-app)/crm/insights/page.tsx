import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InsightsListClient from "./InsightsListClient";

export default async function InsightsPage() {
  const user = await requireUser();

  const documents = await prisma.insightDocument.findMany({
    where: { authorId: user.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  return (
    <InsightsListClient
      documents={documents.map((d) => ({
        id: d.id,
        title: d.title,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))}
    />
  );
}
