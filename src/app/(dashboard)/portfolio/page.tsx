import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SPORT_META, type SportKey } from "@/lib/catalogue/sport-meta";
import PortfolioClient from "./PortfolioClient";

export default async function PortfolioPage() {
  const user = await requireUser();

  const sports = Object.keys(SPORT_META) as SportKey[];
  const [rows, catalogueSettings] = await Promise.all([
    prisma.portfolioProject.findMany({
      where: { archived: false },
      orderBy: [{ featured: "desc" }, { completionDate: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.setting.findMany({
      where: { key: { in: sports.map((s) => `catalogue_${s}_url`) } },
    }),
  ]);
  const catalogueUrlBySport = new Map(
    catalogueSettings.map((s) => [s.key.replace(/^catalogue_/, "").replace(/_url$/, ""), s.value]),
  );

  return (
    <PortfolioClient
      isAdmin={user.role === "admin"}
      initialCatalogues={sports.map((sport) => ({
        sport,
        label: SPORT_META[sport].label,
        url: catalogueUrlBySport.get(sport) ?? null,
      }))}
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
