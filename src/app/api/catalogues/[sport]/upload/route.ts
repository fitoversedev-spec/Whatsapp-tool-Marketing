// Admin upload/replace/remove for a sport's catalogue PDF override
// (Setting key catalogue_<sport>_url) — the polished, Fitoverse-authored
// marketing PDF that attach-catalogue.ts prefers over the auto-rendered
// fallback. The file is used exactly as uploaded (never resized or
// recompressed); the only hard cap is MAX_OVERRIDE_BYTES, which mirrors
// WhatsApp's own document-message size limit — a file past that can never
// be sent regardless of load time, so it's rejected here rather than
// failing later at send time.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadToBlob } from "@/lib/media";
import { getSportMeta } from "@/lib/catalogue/sport-meta";
import { MAX_OVERRIDE_BYTES } from "@/lib/quotation/attach-catalogue";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { sport: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const meta = getSportMeta(params.sport);
  if (!meta) return NextResponse.json({ error: "unknown_sport" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Catalogue must be a PDF file" }, { status: 400 });
  }
  if (file.size > MAX_OVERRIDE_BYTES) {
    const gotMb = (file.size / 1024 / 1024).toFixed(1);
    const capMb = MAX_OVERRIDE_BYTES / 1024 / 1024;
    return NextResponse.json(
      {
        error: `File is ${gotMb}MB — WhatsApp can't send documents over ${capMb}MB, so this can never be delivered to a customer as-is. Re-export/compress it and try again.`,
      },
      { status: 413 },
    );
  }

  let url: string;
  try {
    const uploaded = await uploadToBlob({
      bytes: file,
      fileName: `${params.sport}-catalogue.pdf`,
      mimeType: "application/pdf",
      folder: "catalogues",
    });
    url = uploaded.url;
  } catch (err) {
    return NextResponse.json(
      { error: "Upload failed: " + (err instanceof Error ? err.message : String(err)) },
      { status: 500 },
    );
  }

  const key = `catalogue_${params.sport}_url`;
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: url },
    update: { value: url },
  });

  return NextResponse.json({ ok: true, url, sizeBytes: file.size });
}

export async function DELETE(_req: NextRequest, { params }: { params: { sport: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const meta = getSportMeta(params.sport);
  if (!meta) return NextResponse.json({ error: "unknown_sport" }, { status: 404 });

  await prisma.setting.delete({ where: { key: `catalogue_${params.sport}_url` } }).catch(() => null);

  return NextResponse.json({ ok: true });
}
