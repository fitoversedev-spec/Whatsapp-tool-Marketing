import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PortfolioClient from "./PortfolioClient";

export default async function PortfolioPage() {
  const user = await requireUser();

  const rows = await prisma.portfolioProject.findMany({
    where: { archived: false },
    orderBy: [{ featured: "desc" }, { completionDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { createdBy: { select: { name: true } } },
  });

  return (
    <PortfolioClient
      isAdmin={user.role === "admin"}
      initialProjects={rows.map((p) => ({
        id: p.id,
        customerName: p.customerName,
        location: p.location,
        sport: p.sport,
        completionDate: p.completionDate?.toISOString() ?? null,
        plotLengthFt: p.plotLengthFt,
        plotWidthFt: p.plotWidthFt,
        surfaceType: p.surfaceType,
        surfaceGrade: p.surfaceGrade,
        // Cost intentionally not surfaced to sales — admin sees via API call
        // on edit form.
        shortDescription: p.shortDescription,
        photos: safeJsonArray(p.photos) as { url: string; caption?: string }[],
        heroPhotoUrl: p.heroPhotoUrl,
        videoUrl: p.videoUrl,
        tags: p.tags,
        featured: p.featured,
        createdByName: p.createdBy.name,
        createdAt: p.createdAt.toISOString(),
      }))}
    />
  );
}

function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
