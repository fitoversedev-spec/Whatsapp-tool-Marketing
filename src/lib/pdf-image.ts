// pdf-lib only embeds PNG and JPEG raster images. Product photos — uploaded
// straight from a phone/browser, or carried over from the MVPv2 catalogue
// import — are very often WEBP (or occasionally AVIF/GIF), which pdf-lib
// silently can't embed. Without this conversion, any product in that format
// simply loses its photo everywhere it's used in a PDF (the particulars-table
// row AND the spec card both read from the same embedded-image map), with no
// indication anything went wrong.
//
// sharp is a native dependency (~7 packages, prebuilt binary) — Vercel/Next.js
// officially support it (it's the same library next/image uses for
// self-hosted optimization), so this is a low-risk, standard addition.

import sharp from "sharp";

// Convert arbitrary raster image bytes to PNG. Returns null on failure (e.g.
// truly corrupt bytes) so the caller can fall back to "no photo" instead of
// throwing and breaking the whole PDF render.
export async function convertToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const out = await sharp(bytes).png().toBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

// PNG/JPEG magic-byte sniff, shared by every embed call site so format
// detection is consistent.
export function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50;
}
export function isJpg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}
