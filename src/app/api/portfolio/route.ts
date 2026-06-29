// Portfolio projects — list + create. Admin-only for create + delete;
// both admin and sales can list/read so the catalogue send flow has
// access to featured projects.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const photoSchema = z.object({
  url: z.string().url(),
  caption: z.string().max(300).optional(),
});

const createSchema = z.object({
  customerName: z.string().min(1).max(200),
  location: z.string().max(200).optional().nullable(),
  sport: z.string().min(1).max(40),
  completionDate: z.string().datetime().optional().nullable(),
  plotLengthFt: z.number().int().min(1).max(10_000).optional().nullable(),
  plotWidthFt: z.number().int().min(1).max(10_000).optional().nullable(),
  surfaceType: z.string().max(120).optional().nullable(),
  surfaceGrade: z.string().max(120).optional().nullable(),
  totalCostInr: z.number().min(0).max(99_999_999).optional().nullable(),
  shortDescription: z.string().max(2000).optional().nullable(),
  photos: z.array(photoSchema).max(20).default([]),
  heroPhotoUrl: z.string().url().optional().nullable(),
  videoUrl: z.string().url().optional().nullable(),
  specs: z.record(z.string(), z.unknown()).optional(),
  tags: z.string().max(500).optional().nullable(),
  featured: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const sport = sp.get("sport");
  const featuredOnly = sp.get("featured") === "true";
  const includeArchived = sp.get("includeArchived") === "true";

  const where: Record<string, unknown> = {};
  if (sport) where.sport = sport;
  if (featuredOnly) where.featured = true;
  if (!includeArchived) where.archived = false;

  const rows = await prisma.portfolioProject.findMany({
    where,
    orderBy: [{ featured: "desc" }, { completionDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { createdBy: { select: { name: true } } },
  });

  return NextResponse.json({
    projects: rows.map((p) => ({
      id: p.id,
      customerName: p.customerName,
      location: p.location,
      sport: p.sport,
      completionDate: p.completionDate?.toISOString() ?? null,
      plotLengthFt: p.plotLengthFt,
      plotWidthFt: p.plotWidthFt,
      surfaceType: p.surfaceType,
      surfaceGrade: p.surfaceGrade,
      // Cost is admin-only — never expose to sales role.
      totalCostInr: user.role === "admin" ? p.totalCostInr?.toString() ?? null : null,
      shortDescription: p.shortDescription,
      photos: safeJsonArray(p.photos),
      heroPhotoUrl: p.heroPhotoUrl,
      videoUrl: p.videoUrl,
      specs: safeJsonObject(p.specs),
      tags: p.tags,
      featured: p.featured,
      archived: p.archived,
      createdByName: p.createdBy.name,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "Only admins can add portfolio projects" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const row = await prisma.portfolioProject.create({
    data: {
      customerName: parsed.data.customerName,
      location: parsed.data.location ?? null,
      sport: parsed.data.sport,
      completionDate: parsed.data.completionDate ? new Date(parsed.data.completionDate) : null,
      plotLengthFt: parsed.data.plotLengthFt ?? null,
      plotWidthFt: parsed.data.plotWidthFt ?? null,
      surfaceType: parsed.data.surfaceType ?? null,
      surfaceGrade: parsed.data.surfaceGrade ?? null,
      totalCostInr: parsed.data.totalCostInr ?? null,
      shortDescription: parsed.data.shortDescription ?? null,
      photos: JSON.stringify(parsed.data.photos ?? []),
      heroPhotoUrl: parsed.data.heroPhotoUrl ?? null,
      videoUrl: parsed.data.videoUrl ?? null,
      specs: JSON.stringify(parsed.data.specs ?? {}),
      tags: parsed.data.tags ?? "",
      featured: parsed.data.featured,
      createdByUserId: user.id,
    },
  });

  return NextResponse.json({ project: { id: row.id, sport: row.sport } });
}

function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeJsonObject(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
