// Upload rules shared by the browser (src/lib/blob-client.ts) and the server
// (src/lib/blob-policy.ts). Pure data + helpers only: no node or @vercel/blob
// imports, so it is safe to bundle for the client. media.ts re-exports the
// category helpers so existing imports keep working.

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

// Same idea for pictures/video/audio, for browsers that report an empty type.
const EXT_MIMES: Record<string, string> = {
  ...COMMON_FILE_MIMES,
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

// ── Template header media (Meta WhatsApp Cloud API) ──────────────────────────
export type TemplateHeaderType = "IMAGE" | "VIDEO" | "DOCUMENT";

// Source: developers.facebook.com/docs/whatsapp/cloud-api/reference/media
export const TEMPLATE_ALLOWED_MIME: Record<TemplateHeaderType, readonly string[]> = {
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

export const TEMPLATE_MAX_BYTES: Record<TemplateHeaderType, number> = {
  IMAGE: 5 * 1024 * 1024,
  VIDEO: 16 * 1024 * 1024,
  DOCUMENT: 100 * 1024 * 1024,
};

// ── Direct browser → Blob uploads ────────────────────────────────────────────
export type BlobPurpose =
  | "media" // /api/media/upload (inbox, media library, court images, portfolio, quote photos)
  | "chat" // team-chat attachments
  | "contact" // contact attachments
  | "template" // WhatsApp template header media
  | "catalogue" // admin catalogue PDF
  | "product-image"
  | "product-video"
  | "tds" // product TDS PDFs
  | "sport-tds"; // admin per-sport TDS PDFs

export const BLOB_PURPOSES: readonly BlobPurpose[] = [
  "media",
  "chat",
  "contact",
  "template",
  "catalogue",
  "product-image",
  "product-video",
  "tds",
  "sport-tds",
];

// The token is only valid for a path under this folder; the server re-checks
// the prefix before trusting a blob URL it is handed back.
export const BLOB_FOLDER: Record<BlobPurpose, string> = {
  media: "conversations",
  chat: "chat",
  contact: "contact-attachments",
  template: "templates",
  catalogue: "catalogues",
  "product-image": "products",
  "product-video": "products",
  tds: "tds",
  "sport-tds": "sport-tds",
};

export type BlobUploadPayload = {
  purpose: BlobPurpose;
  contentType: string;
  size: number;
  headerType?: string;
};

// The type the browser should declare for a file: its own, else the extension.
export function resolveContentType(fileName: string, rawType: string, purpose: BlobPurpose): string {
  // "text/plain;charset=utf-8" → "text/plain": the token is locked to the bare type.
  const type = rawType.split(";")[0].trim().toLowerCase();
  const ext = fileName.includes(".") ? (fileName.split(".").pop() ?? "").toLowerCase() : "";
  // The TDS route has always taken any PDF the browser mislabels (empty / x-pdf).
  if (purpose === "tds" && (type === "" || type === "application/x-pdf" || ext === "pdf")) {
    return "application/pdf";
  }
  if (type) return type;
  const guessed = EXT_MIMES[ext];
  if (guessed) return guessed;
  if (purpose === "product-image") return "image/jpeg";
  if (purpose === "product-video") return "video/mp4";
  return "application/octet-stream";
}
