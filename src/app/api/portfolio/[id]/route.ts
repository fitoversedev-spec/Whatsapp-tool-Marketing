// Single portfolio project — get / update / delete. Admin-only for
// mutations; read open to any authenticated user.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const photoSchema = z.object({
  url: z.string().url(),
  caption: z.string().max(300).optional(),
});

const updateSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  location: z.string().max(200).nullable().optional(),
  sport: z.string().min(1).max(40).optional(),
  completionDate: z.string().datetime().nullable().optional(),
  plotLengthFt: z.number().int().min(1).max(10_000).nullable().optional(),
  plotWidthFt: z.number().int().min(1).max(10_000).nullable().optional(),
  surfaceType: z.string().max(120).nullable().optional(),
  surfaceGrade: z.string().max(120).nullable().optional(),
  totalCostInr: z.number().min(0).max(99_999_999).nullable().optional(),
  shortDescription: z.string().max(2000).nullable().optional(),
  photos: z.array(photoSchema).max(20).optional(),
  heroPhotoUrl: z.string().url().nullable().optional(),
  videoUrl: z.string().url().nullable().optional(),
  specs: z.record(z.string(), z.unknown()).optional(),
  tags: z.string().max(500).nullable().optional(),
  featured: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const row = await prisma.portfolioProject.findUnique({
    where: { id: params.id },
    include: { createdBy: { select: { name: true } } },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    project: {
      id: row.id,
      customerName: row.customerName,
      location: row.location,
      sport: row.sport,
      completionDate: row.completionDate?.toISOString() ?? null,
      plotLengthFt: row.plotLengthFt,
      plotWidthFt: row.plotWidthFt,
      surfaceType: row.surfaceType,
      surfaceGrade: row.surfaceGrade,
      totalCostInr: user.role === "admin" ? row.totalCostInr?.toString() ?? null : null,
      shortDescription: row.shortDescription,
      photos: safeJsonArray(row.photos),
      heroPhotoUrl: row.heroPhotoUrl,
      videoUrl: row.videoUrl,
      specs: safeJsonObject(row.specs),
      tags: row.tags,
      featured: row.featured,
      archived: row.archived,
      createdByName: row.createdBy.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const updated = await prisma.portfolioProject.update({
    where: { id: params.id },
    data: {
      ...(data.customerName !== undefined && { customerName: data.customerName }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.sport !== undefined && { sport: data.sport }),
      ...(data.completionDate !== undefined && {
        completionDate: data.completionDate ? new Date(data.completionDate) : null,
      }),
      ...(data.plotLengthFt !== undefined && { plotLengthFt: data.plotLengthFt }),
      ...(data.plotWidthFt !== undefined && { plotWidthFt: data.plotWidthFt }),
      ...(data.surfaceType !== undefined && { surfaceType: data.surfaceType }),
      ...(data.surfaceGrade !== undefined && { surfaceGrade: data.surfaceGrade }),
      ...(data.totalCostInr !== undefined && { totalCostInr: data.totalCostInr }),
      ...(data.shortDescription !== undefined && {
        shortDescription: data.shortDescription,
      }),
      ...(data.photos !== undefined && { photos: JSON.stringify(data.photos) }),
      ...(data.heroPhotoUrl !== undefined && { heroPhotoUrl: data.heroPhotoUrl }),
      ...(data.videoUrl !== undefined && { videoUrl: data.videoUrl }),
      ...(data.specs !== undefined && { specs: JSON.stringify(data.specs) }),
      ...(data.tags !== undefined && { tags: data.tags ?? "" }),
      ...(data.featured !== undefined && { featured: data.featured }),
      ...(data.archived !== undefined && { archived: data.archived }),
    },
  });

  return NextResponse.json({ project: { id: updated.id, sport: updated.sport } });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.portfolioProject.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
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
