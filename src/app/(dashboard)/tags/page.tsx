import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TagsClient from "./TagsClient";

export default async function TagsPage() {
  const user = await requireUser();

  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { contacts: true } } },
  });

  return (
    <TagsClient
      isAdmin={user.role === "admin"}
      initialTags={tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        contactCount: t._count.contacts,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
