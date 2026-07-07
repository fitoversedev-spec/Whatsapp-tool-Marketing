// Products API — list + create. Both admin and sales manage the
// internal product catalogue (floorings, materials, equipment).
//
// GET  ?type=flooring&sport=football   → filtered list
// POST multipart/form-data             → create product, uploading the
//                                         hero image / video to Blob
//
// The create form sends FormData so we can accept file uploads in the
// same request. Text fields: name, type, description, sports (JSON),
// category, specs (JSON), priceInr, unit, baseWork, featured. File
// fields: hero (image), video (optional).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToBlob } from "@/lib/media";
import {
  listProducts,
  createProduct,
  PRODUCT_TYPES,
  type ProductType,
} from "@/lib/products/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const typeParam = req.nextUrl.searchParams.get("type");
  const sport = req.nextUrl.searchParams.get("sport") ?? undefined;
  const type =
    typeParam && PRODUCT_TYPES.includes(typeParam as ProductType)
      ? (typeParam as ProductType)
      : undefined;
  const products = await listProducts({ type, sport });
  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  const type = String(form.get("type") ?? "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!PRODUCT_TYPES.includes(type as ProductType)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }

  let sports: string[] = [];
  try {
    const raw = String(form.get("sports") ?? "[]");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) sports = parsed.filter((s) => typeof s === "string");
  } catch {
    sports = [];
  }

  let specs: Record<string, string> = {};
  try {
    const raw = String(form.get("specs") ?? "{}");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      specs = parsed;
    }
  } catch {
    specs = {};
  }

  const priceRaw = form.get("priceInr");
  const priceInr =
    priceRaw != null && String(priceRaw).trim() !== ""
      ? Number(priceRaw)
      : null;

  // Upload hero image + video if present.
  let heroImageUrl: string | null = null;
  const hero = form.get("hero");
  if (hero instanceof File && hero.size > 0) {
    const bytes = Buffer.from(await hero.arrayBuffer());
    const uploaded = await uploadToBlob({
      bytes,
      fileName: hero.name,
      mimeType: hero.type || "image/jpeg",
      folder: "products",
    });
    heroImageUrl = uploaded.url;
  }

  let videoUrl: string | null = null;
  const video = form.get("video");
  if (video instanceof File && video.size > 0) {
    const bytes = Buffer.from(await video.arrayBuffer());
    const uploaded = await uploadToBlob({
      bytes,
      fileName: video.name,
      mimeType: video.type || "video/mp4",
      folder: "products",
    });
    videoUrl = uploaded.url;
  }

  const product = await createProduct(
    {
      name,
      type: type as ProductType,
      description: String(form.get("description") ?? ""),
      sports,
      category: (form.get("category") as string) || null,
      heroImageUrl,
      videoUrl,
      specs,
      priceInr: priceInr != null && isFinite(priceInr) ? priceInr : null,
      unit: (form.get("unit") as string) || null,
      baseWork: (form.get("baseWork") as string) || null,
      featured: form.get("featured") === "true",
    },
    user.id,
  );

  return NextResponse.json({ product });
}
