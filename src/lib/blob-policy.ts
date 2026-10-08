// Server side of direct browser → Vercel Blob uploads (S18).
//
// Vercel Hobby caps every function request body at 4.5 MB, so the browser
// uploads straight to Blob (see blob-client.ts + /api/blob/upload) and then
// sends only the blob URL to the route that owns the side effects. This file
// holds the per-purpose rules and the checks those routes run on a blob URL
// before trusting it.

import { del, head } from "@vercel/blob";
import {
  BLOB_FOLDER,
  BLOB_PURPOSES,
  MAX_SIZE,
  TEMPLATE_ALLOWED_MIME,
  TEMPLATE_MAX_BYTES,
  categorize,
  type BlobPurpose,
  type BlobUploadPayload,
  type TemplateHeaderType,
} from "@/lib/blob-rules";

export type RuleFail = { ok: false; status: number; error: string };
export type Limits = { allowedContentTypes: string[]; maximumSizeInBytes: number };
export type VerifiedBlob = { url: string; pathname: string; contentType: string; size: number };

const mb = (n: number) => (n / 1024 / 1024).toFixed(0);

// Same role rules the old multipart routes had.
export function roleAllowed(purpose: BlobPurpose, role: string): boolean {
  if (purpose === "catalogue" || purpose === "sport-tds") return role === "admin";
  if (purpose === "product-image" || purpose === "product-video" || purpose === "tds") {
    return role === "admin" || role === "sales";
  }
  return true;
}

// Product photos/video and TDS PDFs had no cap before; these are sanity
// ceilings only (the old 4.5 MB body limit was the real one).
const PRODUCT_IMAGE_MAX = 50 * 1024 * 1024;
const PRODUCT_VIDEO_MAX = 500 * 1024 * 1024;

// Allowed types + max size for a purpose, or the error the old route returned.
export async function checkRules(
  purpose: BlobPurpose,
  contentType: string,
  size: number,
  headerType?: string,
): Promise<{ ok: true; limits: Limits } | RuleFail> {
  const type = contentType.split(";")[0].trim().toLowerCase();
  switch (purpose) {
    case "media":
    case "chat":
    case "contact": {
      const cat = categorize(type);
      if (size > MAX_SIZE[cat]) {
        return { ok: false, status: 413, error: `File too large. Max ${mb(MAX_SIZE[cat])}MB for ${cat} files.` };
      }
      return { ok: true, limits: { allowedContentTypes: [type], maximumSizeInBytes: MAX_SIZE[cat] } };
    }
    case "template": {
      const ht = String(headerType ?? "").toUpperCase() as TemplateHeaderType;
      if (!(ht in TEMPLATE_ALLOWED_MIME)) {
        return { ok: false, status: 400, error: "headerType must be IMAGE, VIDEO, or DOCUMENT" };
      }
      if (!TEMPLATE_ALLOWED_MIME[ht].includes(type)) {
        return {
          ok: false,
          status: 400,
          error: `Invalid file type "${type}" for ${ht} header. Allowed: ${TEMPLATE_ALLOWED_MIME[ht].join(", ")}`,
        };
      }
      if (size > TEMPLATE_MAX_BYTES[ht]) {
        return {
          ok: false,
          status: 413,
          error: `File too large. Max ${mb(TEMPLATE_MAX_BYTES[ht])}MB for ${ht} headers (Meta WhatsApp limit).`,
        };
      }
      return { ok: true, limits: { allowedContentTypes: [type], maximumSizeInBytes: TEMPLATE_MAX_BYTES[ht] } };
    }
    case "catalogue": {
      // Lazy: attach-catalogue pulls in pdf-lib, which the token route doesn't need.
      const { MAX_OVERRIDE_BYTES } = await import("@/lib/quotation/attach-catalogue");
      if (type !== "application/pdf") {
        return { ok: false, status: 400, error: "Catalogue must be a PDF file" };
      }
      if (size > MAX_OVERRIDE_BYTES) {
        const gotMb = (size / 1024 / 1024).toFixed(1);
        const capMb = MAX_OVERRIDE_BYTES / 1024 / 1024;
        return {
          ok: false,
          status: 413,
          error: `File is ${gotMb}MB — WhatsApp can't send documents over ${capMb}MB, so this can never be delivered to a customer as-is. Re-export/compress it and try again.`,
        };
      }
      return { ok: true, limits: { allowedContentTypes: [type], maximumSizeInBytes: MAX_OVERRIDE_BYTES } };
    }
    case "tds":
    case "sport-tds": {
      if (type !== "application/pdf") return { ok: false, status: 400, error: "pdf_only" };
      if (size > MAX_SIZE.document) {
        return { ok: false, status: 413, error: `File too large. Max ${mb(MAX_SIZE.document)}MB for document files.` };
      }
      return { ok: true, limits: { allowedContentTypes: [type], maximumSizeInBytes: MAX_SIZE.document } };
    }
    case "product-image":
    case "product-video": {
      const isImage = purpose === "product-image";
      if (!type.startsWith(isImage ? "image/" : "video/")) {
        return { ok: false, status: 400, error: isImage ? "Hero must be an image file." : "Video must be a video file." };
      }
      const max = isImage ? PRODUCT_IMAGE_MAX : PRODUCT_VIDEO_MAX;
      if (size > max) {
        return { ok: false, status: 413, error: `File too large. Max ${mb(max)}MB for ${isImage ? "image" : "video"} files.` };
      }
      return { ok: true, limits: { allowedContentTypes: [type], maximumSizeInBytes: max } };
    }
  }
}

// Parse the clientPayload the browser sent with its token request.
export function parsePayload(raw: unknown): BlobUploadPayload | null {
  if (typeof raw !== "string") return null;
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    if (!BLOB_PURPOSES.includes(p.purpose)) return null;
    if (typeof p.contentType !== "string" || !p.contentType) return null;
    if (typeof p.size !== "number" || !isFinite(p.size) || p.size < 0) return null;
    return {
      purpose: p.purpose,
      contentType: p.contentType,
      size: p.size,
      headerType: typeof p.headerType === "string" ? p.headerType : undefined,
    };
  } catch {
    return null;
  }
}

// A blob URL we will accept: Vercel Blob's own hosts, or the fake server a
// local test points VERCEL_BLOB_API_URL at.
function trustedBlobUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com")) return u;
  const api = process.env.VERCEL_BLOB_API_URL || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL;
  if (api) {
    try {
      if (new URL(api).host === u.host) return u;
    } catch {
      /* ignore bad env value */
    }
  }
  return null;
}

// Best-effort delete. Callers only pass blobs verifyBlob already confirmed
// (right host, right folder), never a raw client-supplied URL.
export async function dropBlob(url: string): Promise<void> {
  if (!trustedBlobUrl(url)) return;
  try {
    await del(url);
  } catch {
    /* best effort */
  }
}

// Confirms a blob the browser says it uploaded: trusted host, really exists,
// came through a token for this purpose, and passes the purpose's rules on its
// REAL size/type (a rule failure also deletes it).
export async function verifyBlob(
  blobUrl: string,
  purpose: BlobPurpose,
  headerType?: string,
): Promise<{ ok: true; blob: VerifiedBlob } | RuleFail> {
  const u = trustedBlobUrl(blobUrl);
  if (!u) return { ok: false, status: 400, error: "invalid_blob_url" };
  let meta;
  try {
    meta = await head(blobUrl);
  } catch {
    return { ok: false, status: 400, error: "Upload not found — please try again." };
  }
  // The real pathname must sit under this purpose's folder, i.e. it came
  // through a token we issued for it (stops a forged URL to someone else's file).
  if (!meta.pathname.startsWith(BLOB_FOLDER[purpose] + "/")) {
    return { ok: false, status: 400, error: "invalid_blob_url" };
  }
  const contentType = meta.contentType.split(";")[0].trim().toLowerCase();
  const rules = await checkRules(purpose, contentType, meta.size, headerType);
  if (!rules.ok) {
    await dropBlob(meta.url);
    return rules;
  }
  return { ok: true, blob: { url: meta.url, pathname: meta.pathname, contentType, size: meta.size } };
}

// Reads a blob reference from a form field; null when the field is absent.
export async function takeBlobField(
  form: FormData,
  field: string,
  purpose: BlobPurpose,
  headerType?: string,
): Promise<null | { ok: true; blob: VerifiedBlob } | RuleFail> {
  const raw = form.get(field);
  if (typeof raw !== "string" || !raw.trim()) return null;
  return verifyBlob(raw.trim(), purpose, headerType);
}

// Accepts the old multipart body or a JSON body (turned into the same
// FormData shape), so routes keep one code path for their fields. Throws when
// the body can't be parsed.
export async function readUploadForm(req: Request): Promise<FormData> {
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const obj = await req.json();
    const fd = new FormData();
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) if (v != null) fd.append(k, String(v));
    }
    return fd;
  }
  return req.formData();
}

// The file name the browser reported (JSON `name` also accepted).
export function blobFileName(form: FormData, blob: VerifiedBlob): string {
  const given = String(form.get("fileName") ?? form.get("name") ?? "").trim();
  return given || blob.pathname.split("/").pop() || "file";
}
