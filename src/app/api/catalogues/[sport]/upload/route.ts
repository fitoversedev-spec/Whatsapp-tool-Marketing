// Admin upload/replace/remove for a sport's catalogue PDF override
// (Setting key catalogue_<sport>_url) — the polished, Fitoverse-authored
// marketing PDF that attach-catalogue.ts prefers over the auto-rendered
// fallback. The uploaded deck's CONTENT is never resized/recompressed —
// but for sports with a curated page list (see CURATED_PAGES in
// attach-catalogue.ts), only those specific pages are kept, extracted
// here once at upload time. This is deliberate: the raw deck can be
// 50MB+, and fetching that in full on every single quote (even just to
// discard most of it afterward) is what made the catalogue slow/
// unreliable to begin with. Curating once here means every quote request
// afterward just fetches an already-small (~1-3MB) file.
//
// The only hard cap is MAX_OVERRIDE_BYTES, which mirrors WhatsApp's own
// document-message size limit — a file past that can never be sent
// regardless of load time, so it's rejected here rather than failing
// later at send time.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadToBlob } from "@/lib/media";
import { dropBlob, readUploadForm, takeBlobField } from "@/lib/blob-policy";
import { getSportMeta } from "@/lib/catalogue/sport-meta";
import {
  MAX_OVERRIDE_BYTES,
  curateOverridePages,
  hasCuratedPages,
} from "@/lib/quotation/attach-catalogue";

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
    form = await readUploadForm(req);
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  // The browser uploads the deck straight to Blob (Hobby's 4.5 MB body limit)
  // and sends its URL; the multipart `file` path stays for tabs opened before
  // this change.
  const ref = await takeBlobField(form, "blobUrl", "catalogue");
  if (ref) {
    if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: ref.status });
    const raw = ref.blob;
    let url = raw.url;
    let sizeBytes = raw.size;
    try {
      // Only sports with a curated page list need the bytes; otherwise the
      // uploaded blob already is the final file.
      if (hasCuratedPages(params.sport)) {
        const res = await fetch(raw.url, { signal: AbortSignal.timeout(40_000) });
        if (!res.ok) throw new Error(`could not read the uploaded file (${res.status})`);
        const bytes = await curateOverridePages(new Uint8Array(await res.arrayBuffer()), params.sport);
        sizeBytes = bytes.length;
        const uploaded = await uploadToBlob({
          bytes: Buffer.from(bytes),
          fileName: `${params.sport}-catalogue.pdf`,
          mimeType: "application/pdf",
          folder: "catalogues",
        });
        url = uploaded.url;
        await dropBlob(raw.url);
      }
    } catch (err) {
      await dropBlob(raw.url);
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
    return NextResponse.json({ ok: true, url, sizeBytes, originalSizeBytes: raw.size });
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
  let sizeBytes: number;
  try {
    let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
    if (hasCuratedPages(params.sport)) {
      bytes = await curateOverridePages(bytes, params.sport);
    }
    sizeBytes = bytes.length;
    const uploaded = await uploadToBlob({
      bytes: Buffer.from(bytes),
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

  return NextResponse.json({ ok: true, url, sizeBytes, originalSizeBytes: file.size });
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
