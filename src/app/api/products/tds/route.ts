// TDS files API — list by sport (GET), upload (POST multipart),
// remove (DELETE ?id). PDFs only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToBlob } from "@/lib/media";
import { listTdsForSport, createTds, removeTds } from "@/lib/products/store";
import { SPORT_KEYS } from "@/lib/products/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sport = req.nextUrl.searchParams.get("sport");
  if (!sport) return NextResponse.json({ error: "sport_required" }, { status: 400 });
  const files = await listTdsForSport(sport);
  return NextResponse.json({ sport, files });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  const sport = String(form.get("sport") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const productId = (form.get("productId") as string) || null;
  const file = form.get("file");
  if (!SPORT_KEYS.includes(sport as (typeof SPORT_KEYS)[number])) {
    return NextResponse.json({ error: "invalid_sport" }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "pdf_only" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadToBlob({
    bytes,
    fileName: file.name,
    mimeType: "application/pdf",
    folder: `tds/${sport}`,
  });
  const tds = await createTds({
    sport,
    name,
    url: uploaded.url,
    productId,
    uploadedByUserId: user.id,
  });
  return NextResponse.json({ tds });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
  await removeTds(id);
  return NextResponse.json({ ok: true });
}
