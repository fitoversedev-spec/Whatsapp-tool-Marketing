// Single product — update (PATCH, JSON) + archive (DELETE).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToBlob } from "@/lib/media";
import { takeBlobField } from "@/lib/blob-policy";
import {
  getProduct,
  updateProduct,
  archiveProduct,
  PRODUCT_TYPES,
  type ProductType,
  type ProductInput,
} from "@/lib/products/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const product = await getProduct(params.id);
  if (!product) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ product });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Accept either multipart FormData (the Products edit form — supports
  // re-uploading the photo/video) or a plain JSON patch. Only the fields
  // actually present are updated; everything else is left untouched.
  const contentType = req.headers.get("content-type") ?? "";
  let input: Partial<ProductInput> = {};

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
    }
    if (form.has("name")) input.name = String(form.get("name") ?? "").trim();
    if (form.has("type")) input.type = String(form.get("type") ?? "").trim() as ProductType;
    if (form.has("description")) input.description = String(form.get("description") ?? "");
    if (form.has("category")) input.category = (form.get("category") as string) || null;
    if (form.has("unit")) input.unit = (form.get("unit") as string) || null;
    if (form.has("sports")) {
      try {
        const parsed = JSON.parse(String(form.get("sports") ?? "[]"));
        if (Array.isArray(parsed)) input.sports = parsed.filter((s) => typeof s === "string");
      } catch {
        /* ignore malformed sports */
      }
    }
    if (form.has("specs")) {
      try {
        const parsed = JSON.parse(String(form.get("specs") ?? "{}"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          input.specs = parsed as Record<string, string>;
        }
      } catch {
        /* ignore malformed specs */
      }
    }
    if (form.has("priceInr")) {
      const raw = String(form.get("priceInr") ?? "").trim();
      const n = raw === "" ? null : Number(raw);
      input.priceInr = n != null && isFinite(n) ? n : null;
    }
    // Photo/video are either already in Blob (heroBlobUrl / videoBlobUrl) or
    // sent as files (tabs opened before direct uploads).
    const heroRef = await takeBlobField(form, "heroBlobUrl", "product-image");
    if (heroRef && !heroRef.ok) {
      return NextResponse.json({ error: heroRef.error }, { status: heroRef.status });
    }
    const hero = form.get("hero");
    if (heroRef?.ok) {
      input.heroImageUrl = heroRef.blob.url;
    } else if (hero instanceof File && hero.size > 0) {
      const bytes = Buffer.from(await hero.arrayBuffer());
      const uploaded = await uploadToBlob({
        bytes,
        fileName: hero.name,
        mimeType: hero.type || "image/jpeg",
        folder: "products",
      });
      input.heroImageUrl = uploaded.url;
    }
    const videoRef = await takeBlobField(form, "videoBlobUrl", "product-video");
    if (videoRef && !videoRef.ok) {
      return NextResponse.json({ error: videoRef.error }, { status: videoRef.status });
    }
    const video = form.get("video");
    if (videoRef?.ok) {
      input.videoUrl = videoRef.blob.url;
    } else if (video instanceof File && video.size > 0) {
      const bytes = Buffer.from(await video.arrayBuffer());
      const uploaded = await uploadToBlob({
        bytes,
        fileName: video.name,
        mimeType: video.type || "video/mp4",
        folder: "products",
      });
      input.videoUrl = uploaded.url;
    }
  } else {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    input = body;
  }

  if (input.type && !PRODUCT_TYPES.includes(input.type as ProductType)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const updated = await updateProduct(params.id, input);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ product: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await archiveProduct(params.id);
  return NextResponse.json({ ok: true });
}
