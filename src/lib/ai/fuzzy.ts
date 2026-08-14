// Shared fuzzy / typo-tolerant matcher + phone normalization for the AI
// toolboxes. Generalizes the token-score matcher first written inline for
// meta/toolbox.ts's matchCampaigns so a rough, misspelled, or wrong-case
// name/campaign/city the model passes still resolves to the right record
// instead of a false "no data". Used by the new record-lookup tools AND the
// existing rep/sport/city resolvers in analytics/toolbox.ts (which were
// case-insensitive "contains" only — no typo tolerance).

// Strip a phone number down to its digits (drop +, spaces, dashes, brackets),
// so "+91 93638 63382", "09363863382" and "919363863382" all normalize.
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D+/g, "");
}

// The most selective comparable slice of a phone: its last `len` digits (the
// national number for Indian mobiles). A `contains` on this matches a stored
// number regardless of a leading country code / trunk 0.
export function phoneTail(raw: string | null | undefined, len = 10): string {
  const d = normalizePhone(raw);
  return d.length > len ? d.slice(-len) : d;
}

// Lowercased alphanumeric tokens of length >= 2.
export function tokenize(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2);
}

// Bounded Levenshtein — stops early and returns max+1 once the distance is
// known to exceed `max`. Cheap for the short strings (names, single words) this
// runs on.
function editDistance(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = new Array<number>(bl + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[bl];
}

// Is `qt` close to any word in the candidate — a small typo (edit distance 1,
// or 2 for longer tokens) against a single whole word?
function fuzzyWord(qt: string, words: string[]): boolean {
  const maxEdits = qt.length >= 7 ? 2 : 1;
  for (const w of words) {
    if (Math.abs(w.length - qt.length) <= maxEdits && editDistance(w, qt, maxEdits) <= maxEdits) return true;
  }
  return false;
}

// Per-candidate score against the query tokens.
//   coverage — how many query tokens land at all (exact substring, shared
//              4-char prefix, or a small typo). Drives the match threshold.
//   exact    — how many land as a real substring. A tie-break so a lookup for
//              "balaji" prefers the contact literally containing "balaji" over
//              one that merely shares the "bala" prefix.
function scorePair(qTokens: string[], text: string): { coverage: number; exact: number } {
  const lower = (text ?? "").toLowerCase();
  const words = lower.split(/[^a-z0-9]+/i).filter(Boolean);
  let coverage = 0;
  let exact = 0;
  for (const qt of qTokens) {
    if (lower.includes(qt)) {
      coverage += 1;
      exact += 1;
    } else if (qt.length >= 4 && (lower.includes(qt.slice(0, 4)) || fuzzyWord(qt, words))) {
      coverage += 1;
    }
  }
  return { coverage, exact };
}

// Generic fuzzy match. Returns the top-scoring items whose coverage clears at
// least half the query tokens (so a rough multi-word name still resolves), or
// [] when nothing clears the bar. Among equal-coverage items, exact-substring
// matches win so a name lookup stays precise. Case- and typo-tolerant.
export function fuzzyMatch<T>(query: string, items: T[], getText: (item: T) => string): T[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const scored = items.map((item) => ({ item, ...scorePair(qTokens, getText(item)) }));
  const topCoverage = Math.max(0, ...scored.map((s) => s.coverage));
  if (topCoverage === 0 || topCoverage < Math.ceil(qTokens.length / 2)) return [];
  const atTop = scored.filter((s) => s.coverage === topCoverage);
  const topExact = Math.max(0, ...atTop.map((s) => s.exact));
  const best = topExact > 0 ? atTop.filter((s) => s.exact === topExact) : atTop;
  return best.map((s) => s.item);
}
