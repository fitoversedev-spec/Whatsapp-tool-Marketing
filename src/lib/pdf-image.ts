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

// Downscale a raster image so its longest edge is at most `maxDim` px,
// preserving aspect ratio and the source format (sharp mirrors the input
// codec on .toBuffer() when no format method is chained). Product/catalogue
// photos are routinely multi-megapixel phone-camera uploads embedded into
// the quotation PDF at well under 100pt (~1.3in) on screen — pdf-lib's PNG
// embed decodes+recompresses the full pixel buffer, so an un-resized 4000px
// photo costs both a slow embed and a bloated PDF for zero visible gain.
// `withoutEnlargement` makes this a no-op (safe, cheap) for already-small
// images, so it never upscales. Falls back to the original bytes on any
// failure so the caller's existing embed/format-sniff logic is unaffected.
export async function resizeForEmbed(bytes: Uint8Array, maxDim = 900): Promise<Uint8Array> {
  try {
    const out = await sharp(Buffer.from(bytes))
      .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
      .toBuffer();
    return new Uint8Array(out);
  } catch {
    return bytes;
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
