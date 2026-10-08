// Browser helper for the court designer: send the captured pictures (spin
// frames, 2D plan, 3D stills) straight to Vercel Blob and hand back their
// URLs. /api/court-images/spin-file and /combined-pdf then receive only the
// URLs — Hobby caps a function request body at 4.5 MB, far below the size of
// 36 frames or a set of full-quality stills.
//
// The bytes are exactly what the canvas produced (the data URL is decoded,
// never re-encoded or resized), so picture quality is unchanged.

import { uploadFile } from "@/lib/blob-client";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// "data:image/png;base64,…" → a File holding the same bytes.
function dataUrlToFile(dataUrl: string, baseName: string): File {
  const comma = dataUrl.indexOf(",");
  const meta = /^data:(image\/(?:jpeg|png|webp));base64$/i.exec(comma > 0 ? dataUrl.slice(0, comma) : "");
  if (!meta) throw new Error("Could not read a captured picture");
  const type = meta[1].toLowerCase();
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `${baseName}.${EXT[type]}`, { type });
}

// Uploads every data URL (several at a time) with purpose "court-render" and
// returns the Blob URLs in the same order. `onCount(done, total)` fires after
// each finished upload. Throws the first failure (after one retry per picture).
export async function uploadRenders(
  dataUrls: string[],
  baseName: string,
  onCount?: (done: number, total: number) => void,
  parallel = 5,
): Promise<string[]> {
  const total = dataUrls.length;
  const urls = new Array<string>(total);
  const state: { error: unknown; failed: boolean } = { error: null, failed: false };
  let next = 0;
  let done = 0;
  onCount?.(0, total);

  // A progress callback is always passed: it makes the Blob client use XHR
  // for the transfer, which works everywhere (fetch streaming needs HTTP/2).
  const noop = () => {};

  async function worker() {
    while (!state.failed) {
      const i = next++;
      if (i >= total) return;
      try {
        const file = dataUrlToFile(dataUrls[i], `${baseName}-${String(i + 1).padStart(2, "0")}`);
        let up;
        try {
          up = await uploadFile(file, "court-render", noop);
        } catch {
          up = await uploadFile(file, "court-render", noop); // one retry for a flaky connection
        }
        urls[i] = up.url;
        done++;
        onCount?.(done, total);
      } catch (e) {
        state.failed = true;
        state.error = e;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(parallel, total) }, worker));
  if (state.failed) throw state.error instanceof Error ? state.error : new Error("Upload failed");
  return urls;
}
