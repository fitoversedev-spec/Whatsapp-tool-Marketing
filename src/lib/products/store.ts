// Internal product catalogue store. Wraps Prisma for the Product /
// ProductMedia / TdsFile tables so the API routes, the court designer,
// and the chatbot all read products the same way.
//
// Replaces the MVPv2 dependency — products now live in this project's
// own database, uploaded via the Products management page.

import { prisma } from "@/lib/prisma";

export type ProductType = "flooring" | "material" | "equipment";
export const PRODUCT_TYPES: ProductType[] = [
  "flooring",
  "material",
  "equipment",
];

export const SPORT_KEYS = [
  "football",
  "cricket",
  "basketball",
  "pickleball",
  "tennis",
  "badminton",
  "volleyball",
  "multisport",
] as const;
export type SportKey = (typeof SPORT_KEYS)[number];

// Shape returned to clients — JSON fields parsed, Decimal → number.
export type ProductDTO = {
  id: string;
  name: string;
  type: ProductType;
  description: string;
  sports: string[];
  category: string | null;
  heroImageUrl: string | null;
  videoUrl: string | null;
  specs: Record<string, string>;
  priceInr: number | null;
  unit: string | null;
  baseWork: string | null;
  featured: boolean;
  media: Array<{ id: string; url: string; kind: string; caption: string | null }>;
  tdsFiles: Array<{ id: string; name: string; url: string; sport: string }>;
  createdAt: string;
};

function safeJsonArray(v: string): string[] {
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function safeJsonObject(v: string): Record<string, string> {
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

type ProductRow = {
  id: string;
  name: string;
  type: string;
  description: string;
  sports: string;
  category: string | null;
  heroImageUrl: string | null;
  videoUrl: string | null;
  specs: string;
  priceInr: { toString(): string } | null;
  unit: string | null;
  baseWork: string | null;
  featured: boolean;
  createdAt: Date;
  media?: Array<{ id: string; url: string; kind: string; caption: string | null }>;
  tdsFiles?: Array<{ id: string; name: string; url: string; sport: string }>;
};

function toDTO(p: ProductRow): ProductDTO {
  return {
    id: p.id,
    name: p.name,
    type: p.type as ProductType,
    description: p.description,
    sports: safeJsonArray(p.sports),
    category: p.category,
    heroImageUrl: p.heroImageUrl,
    videoUrl: p.videoUrl,
    specs: safeJsonObject(p.specs),
    priceInr: p.priceInr != null ? Number(p.priceInr.toString()) : null,
    unit: p.unit,
    baseWork: p.baseWork,
    featured: p.featured,
    media: (p.media ?? []).map((m) => ({
      id: m.id,
      url: m.url,
      kind: m.kind,
      caption: m.caption,
    })),
    tdsFiles: (p.tdsFiles ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      url: t.url,
      sport: t.sport,
    })),
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listProducts(filter?: {
  type?: ProductType;
  sport?: string;
  includeArchived?: boolean;
}): Promise<ProductDTO[]> {
  const rows = await prisma.product.findMany({
    where: {
      ...(filter?.type ? { type: filter.type } : {}),
      ...(filter?.includeArchived ? {} : { archived: false }),
    },
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    include: {
      media: { orderBy: { sortOrder: "asc" } },
      tdsFiles: true,
    },
  });
  let dtos = rows.map(toDTO);
  // Sport filter is applied in-app because sports is a JSON array
  // column (small N, so this is fine and keeps queries simple).
  if (filter?.sport) {
    dtos = dtos.filter((d) => d.sports.includes(filter.sport!));
  }
  return dtos;
}

export async function getProductsByIds(ids: string[]): Promise<ProductDTO[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: {
      media: { orderBy: { sortOrder: "asc" } },
      tdsFiles: true,
    },
  });
  const dtos = rows.map(toDTO);
  // Preserve the caller's order.
  const byId = new Map(dtos.map((d) => [d.id, d]));
  return ids.map((id) => byId.get(id)).filter((d): d is ProductDTO => !!d);
}

export async function getTdsByIds(ids: string[]): Promise<TdsDTO[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.tdsFile.findMany({ where: { id: { in: ids } } });
  return rows.map((t) => ({
    id: t.id,
    sport: t.sport,
    name: t.name,
    url: t.url,
    productId: t.productId,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function getProduct(id: string): Promise<ProductDTO | null> {
  const row = await prisma.product.findUnique({
    where: { id },
    include: {
      media: { orderBy: { sortOrder: "asc" } },
      tdsFiles: true,
    },
  });
  return row ? toDTO(row) : null;
}

export type ProductInput = {
  name: string;
  type: ProductType;
  description?: string;
  sports: string[];
  category?: string | null;
  heroImageUrl?: string | null;
  videoUrl?: string | null;
  specs?: Record<string, string>;
  priceInr?: number | null;
  unit?: string | null;
  baseWork?: string | null;
  featured?: boolean;
};

export async function createProduct(
  input: ProductInput,
  createdByUserId: string,
): Promise<ProductDTO> {
  const row = await prisma.product.create({
    data: {
      name: input.name,
      type: input.type,
      description: input.description ?? "",
      sports: JSON.stringify(input.sports),
      category: input.category ?? null,
      heroImageUrl: input.heroImageUrl ?? null,
      videoUrl: input.videoUrl ?? null,
      specs: JSON.stringify(input.specs ?? {}),
      priceInr: input.priceInr ?? null,
      unit: input.unit ?? null,
      baseWork: input.baseWork ?? null,
      featured: input.featured ?? false,
      createdByUserId,
    },
    include: { media: true, tdsFiles: true },
  });
  return toDTO(row);
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput>,
): Promise<ProductDTO | null> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.description !== undefined) data.description = input.description;
  if (input.sports !== undefined) data.sports = JSON.stringify(input.sports);
  if (input.category !== undefined) data.category = input.category;
  if (input.heroImageUrl !== undefined) data.heroImageUrl = input.heroImageUrl;
  if (input.videoUrl !== undefined) data.videoUrl = input.videoUrl;
  if (input.specs !== undefined) data.specs = JSON.stringify(input.specs);
  if (input.priceInr !== undefined) data.priceInr = input.priceInr;
  if (input.unit !== undefined) data.unit = input.unit;
  if (input.baseWork !== undefined) data.baseWork = input.baseWork;
  if (input.featured !== undefined) data.featured = input.featured;
  const row = await prisma.product
    .update({
      where: { id },
      data,
      include: { media: { orderBy: { sortOrder: "asc" } }, tdsFiles: true },
    })
    .catch(() => null);
  return row ? toDTO(row) : null;
}

export async function archiveProduct(id: string): Promise<void> {
  await prisma.product
    .update({ where: { id }, data: { archived: true } })
    .catch(() => null);
}

export async function addProductMedia(
  productId: string,
  media: { url: string; kind: "image" | "video"; caption?: string },
): Promise<void> {
  const count = await prisma.productMedia.count({ where: { productId } });
  await prisma.productMedia.create({
    data: {
      productId,
      url: media.url,
      kind: media.kind,
      caption: media.caption ?? null,
      sortOrder: count,
    },
  });
}

export async function removeProductMedia(mediaId: string): Promise<void> {
  await prisma.productMedia.delete({ where: { id: mediaId } }).catch(() => null);
}

// ─── TDS files ────────────────────────────────────────────────────────

export type TdsDTO = {
  id: string;
  sport: string;
  name: string;
  url: string;
  productId: string | null;
  createdAt: string;
};

export async function listTdsForSport(sport: string): Promise<TdsDTO[]> {
  const rows = await prisma.tdsFile.findMany({
    where: { sport },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((t) => ({
    id: t.id,
    sport: t.sport,
    name: t.name,
    url: t.url,
    productId: t.productId,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function createTds(input: {
  sport: string;
  name: string;
  url: string;
  productId?: string | null;
  uploadedByUserId?: string | null;
}): Promise<TdsDTO> {
  const row = await prisma.tdsFile.create({
    data: {
      sport: input.sport,
      name: input.name,
      url: input.url,
      productId: input.productId ?? null,
      uploadedByUserId: input.uploadedByUserId ?? null,
    },
  });
  return {
    id: row.id,
    sport: row.sport,
    name: row.name,
    url: row.url,
    productId: row.productId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function updateTds(
  id: string,
  input: {
    name?: string;
    sport?: string;
    url?: string;
    productId?: string | null;
  },
): Promise<TdsDTO | null> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.sport !== undefined) data.sport = input.sport;
  if (input.url !== undefined) data.url = input.url;
  if (input.productId !== undefined) data.productId = input.productId;
  const row = await prisma.tdsFile
    .update({ where: { id }, data })
    .catch(() => null);
  if (!row) return null;
  return {
    id: row.id,
    sport: row.sport,
    name: row.name,
    url: row.url,
    productId: row.productId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function removeTds(id: string): Promise<void> {
  await prisma.tdsFile.delete({ where: { id } }).catch(() => null);
}
