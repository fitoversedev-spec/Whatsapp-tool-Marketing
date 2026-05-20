import crypto from "crypto";

const APP_SECRET = process.env.META_APP_SECRET || "";

// Verify Meta's X-Hub-Signature-256 header (HMAC-SHA256 over raw body)
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!APP_SECRET || !signatureHeader) return false;
  const expectedSig = signatureHeader.replace(/^sha256=/, "");
  const hmac = crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expectedSig, "hex"));
  } catch {
    return false;
  }
}

// Detects opt-out keywords in inbound message body
export function isOptOutMessage(body: string): boolean {
  if (!body) return false;
  const normalized = body.trim().toLowerCase();
  return /^(stop|unsubscribe|opt[\s-]?out|cancel)$/i.test(normalized);
}
