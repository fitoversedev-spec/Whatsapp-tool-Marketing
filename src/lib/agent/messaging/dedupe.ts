/** The same text to the same conversation within this window is a duplicate. */
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/** Compare texts ignoring case, surrounding space and runs of whitespace. */
export function normaliseText(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The most recent earlier message with the same text inside the window, or null. */
export function findDuplicate<T extends { body: string | null; createdAt: Date }>(
  recent: readonly T[],
  text: string,
  now: number,
  windowMs: number = DEDUPE_WINDOW_MS,
): T | null {
  const want = normaliseText(text);
  if (!want) return null;
  let best: T | null = null;
  for (const m of recent) {
    const age = now - m.createdAt.getTime();
    if (age > windowMs) continue;
    if (normaliseText(m.body) !== want) continue;
    if (!best || m.createdAt.getTime() > best.createdAt.getTime()) best = m;
  }
  return best;
}
