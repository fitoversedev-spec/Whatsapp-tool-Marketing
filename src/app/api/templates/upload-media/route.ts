// Uploads template header media (image, video, document) to Vercel Blob.
//
// Flow:
// 1. Admin/sales picks a file in the template draft UI
// 2. UI POSTs the file here as multipart/form-data with field "file" + "headerType"
// 3. We validate MIME + size against Meta's WhatsApp Cloud API limits
// 4. Upload to Vercel Blob → get back a permanent public URL
// 5. UI receives { url, format } and stores it in the template's header JSON
// 6. On submit_to_meta, the URL is passed as header_handle so Meta can review it
// 7. On send, the URL is included as the header parameter on the message
//
// Vercel Blob requirements:
// - Create a Blob store in the Vercel dashboard for the project
// - Vercel automatically injects BLOB_READ_WRITE_TOKEN as an env var
// - For local dev, copy that token into .env

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getCurrentUser } from "@/lib/auth";

type HeaderType = "IMAGE" | "VIDEO" | "DOCUMENT";

// Meta's WhatsApp Cloud API supported media types for templates.
// Source: developers.facebook.com/docs/whatsapp/cloud-api/reference/media
const ALLOWED_MIME: Record<HeaderType, readonly string[]> = {
  IMAGE: ["image/jpeg", "image/png"],
  VIDEO: ["video/mp4", "video/3gpp"],
  DOCUMENT: [
    "application/pdf",
    "application/vnd.ms-powerpoint",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ],
};

const MAX_SIZE_BYTES: Record<HeaderType, number> = {
  IMAGE: 5 * 1024 * 1024,
  VIDEO: 16 * 1024 * 1024,
  DOCUMENT: 100 * 1024 * 1024,
};

export const runtime = "nodejs"; // needed for formData() and @vercel/blob

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  const headerTypeRaw = String(formData.get("headerType") ?? "").toUpperCase();
  const headerType = headerTypeRaw as HeaderType;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (!(headerType in ALLOWED_MIME)) {
    return NextResponse.json(
      { error: "headerType must be IMAGE, VIDEO, or DOCUMENT" },
      { status: 400 }
    );
  }

  if (!ALLOWED_MIME[headerType].includes(file.type)) {
    return NextResponse.json(
      {
        error: `Invalid file type "${file.type}" for ${headerType} header. Allowed: ${ALLOWED_MIME[headerType].join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE_BYTES[headerType]) {
    const limitMb = (MAX_SIZE_BYTES[headerType] / 1024 / 1024).toFixed(0);
    return NextResponse.json(
      { error: `File too large. Max ${limitMb}MB for ${headerType} headers (Meta WhatsApp limit).` },
      { status: 413 }
    );
  }

  // Build a stable, low-collision path. Files are immutable once uploaded.
  const ext =
    (file.name.split(".").pop() || file.type.split("/").pop() || "bin").toLowerCase();
  const slug = file.name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const pathname = `templates/${headerType.toLowerCase()}/${stamp}-${slug || "media"}.${ext}`;

  try {
    const blob = await put(pathname, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: false,
    });

    return NextResponse.json({
      ok: true,
      url: blob.url,
      pathname: blob.pathname,
      format: headerType,
      contentType: file.type,
      size: file.size,
      filename: file.name,
    });
  } catch (err: any) {
    // Most common cause locally: BLOB_READ_WRITE_TOKEN isn't set in .env.
    const message = err?.message ?? "Upload failed";
    const hint = !process.env.BLOB_READ_WRITE_TOKEN
      ? " (BLOB_READ_WRITE_TOKEN missing — create a Vercel Blob store and copy the token to .env)"
      : "";
    return NextResponse.json({ error: message + hint }, { status: 500 });
  }
}
