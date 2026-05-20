import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TemplatesClient from "./TemplatesClient";

export default async function TemplatesPage() {
  const user = await requireUser();
  const templates = await prisma.template.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      draftedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
  });

  return (
    <TemplatesClient
      currentUser={{ role: user.role }}
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        body: t.body,
        footer: t.footer,
        status: t.status,
        rejectionReason: t.rejectionReason,
        draftedByName: t.draftedBy.name,
        approvedByName: t.approvedBy?.name ?? null,
        updatedAt: t.updatedAt.toISOString(),
      }))}
    />
  );
}
