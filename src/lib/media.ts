// Shared media helpers used by upload + webhook flows.

import { put } from "@vercel/blob";

export type MediaCategory = "image" | "video" | "audio" | "document" | "other";

export function categorize(mimeType: string): MediaCategory {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("application/vnd.") ||
    mimeType === "application/msword" ||
    mimeType.startsWith("text/")
  ) {
    return "document";
  }
  return "other";
}

// Meta's WhatsApp Cloud API media size limits per category.
// https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#supported-media-types
export const MAX_SIZE: Record<MediaCategory, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  other: 16 * 1024 * 1024,
};

export async function uploadToBlob(args: {
  bytes: Buffer | File;
  fileName: string;
  mimeType: string;
  folder?: string;
}): Promise<{ url: string; pathname: string }> {
  const folder = args.folder ?? "conversations";
  const slug = args.fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const ext =
    args.fileName.split(".").pop()?.toLowerCase() ||
    args.mimeType.split("/")[1] ||
    "bin";
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const pathname = `${folder}/${stamp}-${slug || "media"}.${ext}`;

  const blob = await put(pathname, args.bytes, {
    access: "public",
    contentType: args.mimeType,
    addRandomSuffix: false,
  });
  return { url: blob.url, pathname: blob.pathname };
}

// Friendly extension → mime fallback for files whose mime browsers don't
// recognize. Used to make the file-picker accept attribute resilient.
export const COMMON_FILE_MIMES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
};
