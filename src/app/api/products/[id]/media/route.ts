// Product gallery media — add (POST multipart) + remove (DELETE ?mediaId).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToBlob } from "@/lib/media";
import { addProductMedia, removeProductMedia } from "@/lib/products/store";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  const kind = file.type.startsWith("video/") ? "video" : "image";
  const bytes = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadToBlob({
    bytes,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    folder: "products",
  });
  await addProductMedia(params.id, {
    url: uploaded.url,
    kind,
    caption: (form.get("caption") as string) || undefined,
  });
  return NextResponse.json({ ok: true, url: uploaded.url, kind });
}

export async function DELETE(
  req: NextRequest,
  _ctx: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const mediaId = req.nextUrl.searchParams.get("mediaId");
  if (!mediaId) return NextResponse.json({ error: "mediaId_required" }, { status: 400 });
  await removeProductMedia(mediaId);
  return NextResponse.json({ ok: true });
}
