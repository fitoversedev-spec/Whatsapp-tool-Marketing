// WinAnsi-safe text sanitisation for the quotation PDF. pdf-lib's built-in
// Helvetica fonts use the WinAnsi character set (Western-European glyphs only);
// anything outside it throws "WinAnsi cannot encode" at draw time. We pre-map
// the characters real quotations contain (rupee, math operators, arrows,
// ellipsis, smart quotes) to WinAnsi-safe equivalents, then strip any remaining
// unsupported codepoints.
//
// Extracted to its own dependency-free (client-safe) module so the quote WIZARD
// can split words on the EXACT same basis as the renderer — highlight word
// indices must line up on both ends, and sanitize() can change the
// whitespace-split word list (a stripped standalone token shifts indices).

export const SAFE_REPLACEMENTS: Record<string, string> = {
  "₹": "Rs.",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "…": "...",
  "→": "->",
  "←": "<-",
  "—": "-",
  "–": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  " ": " ",
  "•": "-",
};

export function sanitize(text: string): string {
  if (!text) return "";
  let out = text;
  for (const [from, to] of Object.entries(SAFE_REPLACEMENTS)) {
    out = out.split(from).join(to);
  }
  // Drop any remaining codepoints WinAnsi can't render (emoji, CJK, etc.).
  // 0x00-0xFF covers everything Helvetica's WinAnsi knows about.
  out = out.replace(/[^\x00-\xFF]/g, "");
  return out;
}
