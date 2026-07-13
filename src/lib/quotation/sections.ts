// Scope sections for the quotation flow. A quote's line items (and the rate
// sheet they come from) are grouped under these fixed headings, shown in the
// wizard, the rate-sheet editor, and the generated PDF.
//
// The 7 headings are fixed (order matters). Every item carries an optional
// `section`; when absent we infer one from the item name so legacy items,
// custom items, and un-tagged rate sheets slot in sensibly. An explicit
// section (set by an admin in the editor) always wins over inference.

export const QUOTE_SECTIONS = [
  "Base Preparation",
  "Sports Flooring",
  "Fabrication & Structural",
  "Lights",
  "Equipment",
  "Safety Pads",
  "Accessories",
] as const;

export type QuoteSection = (typeof QUOTE_SECTIONS)[number];

export const DEFAULT_SECTION: QuoteSection = "Base Preparation";

// Sort index for a section (unknown/legacy → after the known ones, stable).
export function sectionOrder(s: string | null | undefined): number {
  const i = (QUOTE_SECTIONS as readonly string[]).indexOf(s ?? "");
  return i === -1 ? QUOTE_SECTIONS.length : i;
}

// Normalise an arbitrary saved value onto one of the fixed sections.
export function coerceSection(s: string | null | undefined): QuoteSection | null {
  if (!s) return null;
  return (QUOTE_SECTIONS as readonly string[]).includes(s) ? (s as QuoteSection) : null;
}

// Best-guess section from an item's name (keyword rules, checked in order so
// e.g. "tennis post (with net)" resolves to Equipment, not Structural).
export function inferSection(name: string | null | undefined): QuoteSection {
  const n = (name ?? "").toLowerCase();
  const has = (re: RegExp) => re.test(n);
  if (has(/turf|flooring|acrylic|vinyl|synthetic|carpet|court\s*coat|surface|pvc|pp\s*tile/)) {
    return "Sports Flooring";
  }
  if (has(/light|led|flood|lux|lamp|illumin/)) return "Lights";
  if (has(/\bpost\b|board|hoop|goal|stump|ratchet|\bbat\b|\bball\b|shuttle|racket|equipment/)) {
    return "Equipment";
  }
  if (has(/padding|\bpad\b|rexine|foam|cushion\s*wall|safety/)) return "Safety Pads";
  if (has(/accessor/)) return "Accessories";
  if (has(/net|fenc|fabricat|structur|shell|roofing|framing|wire\s*rope|truss|purlin|ms\s*(pole|pipe|structure)/)) {
    return "Fabrication & Structural";
  }
  // Base Preparation is the safe default (sub-base, chemical, walls, civil, drains…).
  return "Base Preparation";
}

// Section for an item: any explicit (non-empty) section wins — including
// admin-added CUSTOM sections — else inferred from the name.
export function sectionForItem(item: { section?: string | null; name?: string | null }): string {
  const s = (item.section ?? "").trim();
  return s || inferSection(item.name);
}

// The fixed 7 sections first, then any extra/custom sections (first-seen order,
// de-duped). Used to render the wizard + editor so custom sections still show.
export function orderedSectionsFor(extra: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of QUOTE_SECTIONS) {
    out.push(s);
    seen.add(s);
  }
  for (const s of extra) {
    const t = (s ?? "").trim();
    if (t && !seen.has(t)) {
      out.push(t);
      seen.add(t);
    }
  }
  return out;
}
