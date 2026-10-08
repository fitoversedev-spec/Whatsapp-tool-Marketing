// Browser helper: upload a file straight to Vercel Blob, bypassing the 4.5 MB
// function body limit. The server (/api/blob/upload) only hands out a short
// token after checking the user, purpose, type and size; the caller then
// sends the returned URL to the route that records it.

import { upload } from "@vercel/blob/client";
import { BLOB_FOLDER, resolveContentType, type BlobPurpose } from "@/lib/blob-rules";

const MULTIPART_OVER = 10 * 1024 * 1024;

export type UploadedBlob = { url: string; pathname: string; contentType: string; size: number };

// folder/slug.ext (the server adds a random suffix, so names can repeat).
function buildPath(purpose: BlobPurpose, fileName: string, contentType: string): string {
  const slug =
    fileName
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40) || "media";
  const rawExt = fileName.includes(".") ? (fileName.split(".").pop() ?? "") : "";
  const ext =
    (rawExt || (contentType.split("/")[1] ?? "")).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  return `${BLOB_FOLDER[purpose]}/${slug}.${ext}`;
}

// The Blob client hides why a token was refused; ask the route for its message
// (null = the checks pass, so the failure was the transfer itself).
async function explain(clientPayload: string): Promise<string | null> {
  try {
    const res = await fetch("/api/blob/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "upload.check", clientPayload }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j?.error) return String(j.error);
    }
  } catch {
    /* network trouble: treat as a failed transfer */
  }
  return null;
}

// `opts.headerType` is only for purpose "template" (IMAGE | VIDEO | DOCUMENT).
export async function uploadFile(
  file: File,
  purpose: BlobPurpose,
  onProgress?: (percent: number) => void,
  opts?: { headerType?: string },
): Promise<UploadedBlob> {
  const contentType = resolveContentType(file.name, file.type, purpose);
  const clientPayload = JSON.stringify({
    purpose,
    contentType,
    size: file.size,
    headerType: opts?.headerType,
  });
  try {
    const blob = await upload(buildPath(purpose, file.name, contentType), file, {
      access: "public",
      handleUploadUrl: "/api/blob/upload",
      clientPayload,
      contentType,
      multipart: file.size > MULTIPART_OVER,
      onUploadProgress: onProgress ? (e) => onProgress(Math.round(e.percentage)) : undefined,
    });
    return { url: blob.url, pathname: blob.pathname, contentType, size: file.size };
  } catch (err) {
    console.error("[blob-client] upload failed", err);
    throw new Error((await explain(clientPayload)) ?? "Upload failed");
  }
}
