import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CourtImagesClient from "./CourtImagesClient";

export default async function CourtImagesPage() {
  const user = await requireUser();

  const where = user.role === "admin" ? {} : { createdByUserId: user.id };
  const rows = await prisma.courtImage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { createdBy: { select: { name: true } } },
  });

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
        sports: safeSports(c.layout),
      }))}
    />
  );
}

function safeSports(layoutJson: string): string[] {
  try {
    const parsed = JSON.parse(layoutJson);
    return Array.isArray(parsed?.sports) ? parsed.sports : [];
  } catch {
    return [];
  }
}
