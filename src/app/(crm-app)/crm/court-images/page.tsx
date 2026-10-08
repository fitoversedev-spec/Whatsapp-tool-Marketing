import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { COURT_IMAGE_LIST_SELECT, sportsByCourtImageId } from "@/lib/court-image/list";
import CourtImagesClient from "@/app/(dashboard)/court-images/CourtImagesClient";

export default async function CrmCourtImagesPage() {
  const user = await requireUser();

  const where = user.role === "admin" ? {} : { createdByUserId: user.id };
  const rows = await prisma.courtImage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: COURT_IMAGE_LIST_SELECT,
  });
  const sportsById = await sportsByCourtImageId(rows.map((c) => c.id));

  return (
    <CourtImagesClient
      isAdmin={user.role === "admin"}
      initialCourtImages={rows.map((c) => ({
        id: c.id,
        number: c.number,
        customerName: c.customerName,
        imageUrl: c.imageUrl,
        caption: c.caption,
        status: c.status,
        contactPhone: c.contactPhone,
        conversationId: c.conversationId,
        sentAt: c.sentAt?.toISOString() ?? null,
        createdByName: c.createdBy.name,
        createdAt: c.createdAt.toISOString(),
        sports: sportsById.get(c.id) ?? [],
      }))}
    />
  );
}
