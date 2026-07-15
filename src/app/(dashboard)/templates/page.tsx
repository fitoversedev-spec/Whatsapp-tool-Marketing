import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TemplatesClient from "./TemplatesClient";
import type { Role } from "@/lib/rbac";

// When ?showDeleted=1 is set in the URL, include soft-deleted templates
// (with a "deleted" badge + restore button). Default view excludes them.
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: { showDeleted?: string };
}) {
  const user = await requireUser();
  const showDeleted = searchParams?.showDeleted === "1";

  const templates = await prisma.template.findMany({
    where: showDeleted ? undefined : { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      draftedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
  });

  return (
    <TemplatesClient
      currentUser={{ role: user.role as Role }}
      showDeleted={showDeleted}
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        header: t.header,
        body: t.body,
        footer: t.footer,
        status: t.status,
        rejectionReason: t.rejectionReason,
        draftedByName: t.draftedBy.name,
        approvedByName: t.approvedBy?.name ?? null,
        updatedAt: t.updatedAt.toISOString(),
        deletedAt: t.deletedAt?.toISOString() ?? null,
      }))}
    />
  );
}
