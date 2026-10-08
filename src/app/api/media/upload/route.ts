// General-purpose media upload for conversation messages + the media library.
// Wider mime allowance than the template-specific endpoint — supports any
// file Meta accepts in WhatsApp media messages.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { categorize, MAX_SIZE, uploadToBlob } from "@/lib/media";
import { blobFileName, readUploadForm, takeBlobField } from "@/lib/blob-policy";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await readUploadForm(req);
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  // Large files arrive as a Blob URL (browser uploaded them straight to Blob);
  // the multipart `file` path stays for tabs opened before this change.
  let url: string;
  let mimeType: string;
  let fileName: string;
  let size: number;
  let cat: ReturnType<typeof categorize>;

  const ref = await takeBlobField(form, "blobUrl", "media");
  if (ref) {
    if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: ref.status });
    url = ref.blob.url;
    mimeType = ref.blob.contentType;
    fileName = blobFileName(form, ref.blob);
    size = ref.blob.size;
    cat = categorize(mimeType);
  } else {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }

    cat = categorize(file.type);
    if (file.size > MAX_SIZE[cat]) {
      const limitMb = (MAX_SIZE[cat] / 1024 / 1024).toFixed(0);
      return NextResponse.json(
        { error: `File too large. Max ${limitMb}MB for ${cat} files.` },
        { status: 413 }
      );
    }

    try {
      const result = await uploadToBlob({
        bytes: file,
        fileName: file.name,
        mimeType: file.type,
      });
      url = result.url;
    } catch (err: any) {
      const hint = !process.env.BLOB_READ_WRITE_TOKEN
        ? " (BLOB_READ_WRITE_TOKEN missing — set in .env)"
        : "";
      return NextResponse.json({ error: (err?.message ?? "upload failed") + hint }, { status: 500 });
    }
    mimeType = file.type;
    fileName = file.name;
    size = file.size;
  }

  // Persist a Media row so the file appears in /media library.
  const media = await prisma.media.create({
    data: {
      url,
      mimeType,
      fileName,
      size,
      category: cat,
      uploadedByUserId: user.id,
    },
  });

  return NextResponse.json({
    ok: true,
    media: {
      id: media.id,
      url: media.url,
      mimeType: media.mimeType,
      fileName: media.fileName,
      size: media.size,
      category: media.category,
    },
  });
}
