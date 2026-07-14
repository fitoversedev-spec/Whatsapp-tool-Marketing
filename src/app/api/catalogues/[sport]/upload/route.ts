// Admin upload/replace/remove for a sport's catalogue PDF override
// (Setting key catalogue_<sport>_url) — the polished, Fitoverse-authored
// marketing PDF that attach-catalogue.ts prefers over the auto-rendered
// fallback. Enforces the same MAX_OVERRIDE_BYTES cap that
// attach-catalogue.ts silently falls back on at fetch time, so an
// oversized file (a raw Canva/print export can run 50MB+) is rejected
// here instead of quietly degrading every quote/design generated
// afterwards.

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
        error: `File is ${gotMb}MB — must be ${capMb}MB or under. Re-export/compress it (most design tools have a "web" or "compressed" export option) and try again.`,
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
  // The old cached copy (if any) is now for a different sourceUrl, so
  // attach-catalogue.ts's cache check will naturally miss and repopulate —
  // no explicit invalidation needed, but drop the stale row for tidiness.
  await prisma.setting
    .delete({ where: { key: `catalogue_${params.sport}_cache` } })
    .catch(() => null);

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
  await prisma.setting.delete({ where: { key: `catalogue_${params.sport}_cache` } }).catch(() => null);

  return NextResponse.json({ ok: true });
}
