// Shared media helpers used by upload + webhook flows.

import { put } from "@vercel/blob";

// Category/size rules live in blob-rules.ts so the browser can share them.
export { categorize, MAX_SIZE, COMMON_FILE_MIMES } from "./blob-rules";
export type { MediaCategory } from "./blob-rules";

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

  // Give up after 25 s so a stalled upload fails with a message instead of
  // running into the platform's silent 60 s kill.
  const signal = AbortSignal.timeout(25_000);
  try {
    const blob = await put(pathname, args.bytes, {
      access: "public",
      contentType: args.mimeType,
      addRandomSuffix: false,
      abortSignal: signal,
    });
    return { url: blob.url, pathname: blob.pathname };
  } catch (err) {
    if (signal.aborted) {
      const msg = (err as { message?: string } | null)?.message ?? "upload failed";
      throw new Error(`${msg} Upload took too long (25 s).`);
    }
    throw err;
  }
}
