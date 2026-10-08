// Server side of the court designer's direct-to-Blob picture uploads.
//
// Vercel Hobby caps every function request body at 4.5 MB, so the browser
// uploads each spin frame / 2D / 3D picture straight to Blob (purpose
// "court-render") and sends only the URLs to /api/court-images/spin-file and
// /combined-pdf. These helpers check each URL the same way every other direct
// upload is checked (verifyBlob: trusted host, really exists, right folder,
// type/size rules), download the bytes with time limits, and delete the
// temporary pictures once the output file is built.

import { del } from "@vercel/blob";
import { verifyBlob } from "@/lib/blob-policy";
import { deadline, fetchT, isTimeoutError, withTimeout } from "@/lib/http";

// More than any real set (36 spin frames, or 1 top-down + 6 angles).
export const MAX_RENDER_URLS = 64;

const VERIFY_MS = 10_000; // blob head() per picture
const FETCH_EACH_MS = 15_000; // download per picture
const FETCH_TOTAL_MS = 30_000; // all pictures together, so the 60 s function limit is never hit silently
const PARALLEL = 6;

export class RenderInputError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type RenderImage = { url: string; contentType: string; bytes: Uint8Array };

// The strings in a JSON field, or null when the field isn't an array.
export function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
}

// Verifies and downloads every URL (a few at a time), keeping the input order.
// Throws RenderInputError with a readable message if any picture is bad or slow.
export async function loadRenderImages(urls: string[]): Promise<RenderImage[]> {
  if (urls.length > MAX_RENDER_URLS) throw new RenderInputError(400, "too_many_images");
  const budget = deadline(FETCH_TOTAL_MS);
  const out = new Array<RenderImage>(urls.length);
  const state: { error: RenderInputError | null } = { error: null };
  let next = 0;

  async function worker() {
    while (!state.error) {
      const i = next++;
      if (i >= urls.length) return;
      try {
        const v = await withTimeout(verifyBlob(urls[i], "court-render"), VERIFY_MS, "Blob storage");
        if (!v.ok) throw new RenderInputError(v.status, v.error);
        const left = budget.remaining();
        if (left <= 0) throw new RenderInputError(504, "Reading the pictures took too long — please try again.");
        const res = await fetchT("Blob storage", v.blob.url, undefined, Math.min(FETCH_EACH_MS, left));
        if (!res.ok) throw new RenderInputError(502, "Could not read an uploaded picture — please try again.");
        out[i] = {
          url: v.blob.url,
          contentType: v.blob.contentType,
          bytes: new Uint8Array(await res.arrayBuffer()),
        };
      } catch (e) {
        state.error =
          e instanceof RenderInputError
            ? e
            : isTimeoutError(e)
              ? new RenderInputError(504, "Reading the pictures took too long — please try again.")
              : new RenderInputError(502, "Could not read an uploaded picture — please try again.");
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, urls.length) }, worker));
  if (state.error) throw state.error;
  return out;
}

// Deletes the temporary pictures (best effort, one call). Only URLs that
// loadRenderImages already verified should be passed in.
export async function dropRenderImages(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  try {
    await withTimeout(del(urls), 8_000, "Blob storage");
  } catch {
    /* best effort: leftovers are harmless */
  }
}
