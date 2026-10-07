// A tab still running an older build after a deploy asks the server for code
// chunks that no longer exist ("ChunkLoadError" / "Loading chunk … failed").
// Reloading once switches it to the new version. Used by the route error
// screens (ErrorScreen.tsx) and by on-demand imports (lazyImport below).

export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  return (
    e?.name === "ChunkLoadError" ||
    /Loading (CSS )?chunk|ChunkLoadError|dynamically imported module|Importing a module script failed/i.test(e?.message ?? "")
  );
}

const RELOAD_KEY = "ccd_chunk_reload_at";

/** Reload onto the new version — at most once per 30 s, so a real outage can't cause a reload loop. */
export function reloadOnceForNewVersion(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // can't remember the last attempt — don't risk a loop
  }
  window.location.reload();
  return true;
}

/** Load a code-split module on demand (e.g. the Excel library on "Export"); reloads once if the tab's build is outdated. */
export async function lazyImport<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (isChunkLoadError(err) && reloadOnceForNewVersion()) return new Promise<T>(() => {});
    throw err;
  }
}
