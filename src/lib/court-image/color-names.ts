// Resolve a human colour NAME (typed by sales) to a hex value for
// highlight zones. Covers the standard CSS named colours plus common
// Indian-market aliases sales actually use ("sky blue", "maroon",
// "sea green", "peacock blue", etc.). Falls back to null when the name
// can't be resolved so the caller can keep the current colour + warn.
//
// Case / spacing / punctuation insensitive: "Sky Blue", "sky-blue",
// "skyblue" all resolve the same.

// Common aliases → canonical CSS name or hex. Extend as sales asks.
const ALIASES: Record<string, string> = {
  // Blues
  "sky blue": "#87CEEB",
  skyblue: "#87CEEB",
  "sea blue": "#006994",
  "peacock blue": "#1B6C8C",
  "royal blue": "#4169E1",
  "navy blue": "#000080",
  "ink blue": "#1F2A5A",
  "electric blue": "#0892D0",
  // Greens
  "sea green": "#2E8B57",
  "grass green": "#3E8A47",
  "bottle green": "#006A4E",
  "lime green": "#32CD32",
  "olive green": "#708238",
  "forest green": "#228B22",
  "mint green": "#98FF98",
  // Reds / warm
  "brick red": "#8B3A3A",
  "blood red": "#7E191B",
  "rose red": "#C21E56",
  "cherry red": "#B31B1B",
  scarlet: "#FF2400",
  crimson: "#DC143C",
  // Oranges / yellows
  "burnt orange": "#CC5500",
  amber: "#FFBF00",
  mustard: "#FFDB58",
  "golden yellow": "#FFDF00",
  // Purples / pinks
  "sky purple": "#B39DDB",
  lavender: "#B57EDC",
  magenta: "#FF00FF",
  fuchsia: "#FF00FF",
  // Neutrals
  "off white": "#F8F8F0",
  cream: "#FFFDD0",
  charcoal: "#36454F",
  "slate grey": "#708090",
  "slate gray": "#708090",
  ash: "#B2BEB5",
  // Court-relevant brand tones
  "court blue": "#1E60A8",
  "court green": "#3D7A47",
  "tile red": "#B93430",
  "acrylic blue": "#2C5DA5",
  "acrylic green": "#3E7D47",
  "turf green": "#3E8A47",
};

// The subset of CSS Level-4 named colours we support directly. Kept
// inline (no DOM dependency) so it works server-side too. This is the
// widely-used set; obscure names fall through to null.
const CSS_NAMES: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  orange: "#FFA500",
  purple: "#800080",
  pink: "#FFC0CB",
  brown: "#A52A2A",
  grey: "#808080",
  gray: "#808080",
  cyan: "#00FFFF",
  teal: "#008080",
  maroon: "#800000",
  olive: "#808000",
  navy: "#000080",
  lime: "#00FF00",
  aqua: "#00FFFF",
  silver: "#C0C0C0",
  gold: "#FFD700",
  indigo: "#4B0082",
  violet: "#EE82EE",
  turquoise: "#40E0D0",
  salmon: "#FA8072",
  coral: "#FF7F50",
  khaki: "#F0E68C",
  beige: "#F5F5DC",
  tan: "#D2B48C",
  ivory: "#FFFFF0",
  plum: "#DDA0DD",
  orchid: "#DA70D6",
  tomato: "#FF6347",
  chocolate: "#D2691E",
  crimson: "#DC143C",
  "royal blue": "#4169E1",
  "sky blue": "#87CEEB",
  "sea green": "#2E8B57",
  "forest green": "#228B22",
  "dark green": "#006400",
  "light green": "#90EE90",
  "dark blue": "#00008B",
  "light blue": "#ADD8E6",
  "dark red": "#8B0000",
};

function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

// Returns { hex } when resolved, or { hex: null, suggestion } with a
// short hint when not. Accepts a raw hex too (#rrggbb / #rgb) so sales
// can still paste a code if they prefer.
export function resolveColorName(input: string): {
  hex: string | null;
  matched: string | null;
} {
  const raw = input.trim();
  // Direct hex passthrough.
  const hexMatch = raw.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hexMatch) {
    const h = hexMatch[1];
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return { hex: `#${full.toUpperCase()}`, matched: `#${full}` };
  }
  const key = normalise(raw);
  if (ALIASES[key]) return { hex: ALIASES[key], matched: key };
  if (CSS_NAMES[key]) return { hex: CSS_NAMES[key], matched: key };
  // Drop a trailing "colour"/"color" word ("red colour" → "red").
  const stripped = key.replace(/\s*colou?r$/, "").trim();
  if (stripped !== key) {
    if (ALIASES[stripped]) return { hex: ALIASES[stripped], matched: stripped };
    if (CSS_NAMES[stripped])
      return { hex: CSS_NAMES[stripped], matched: stripped };
  }
  return { hex: null, matched: null };
}

// All names we can resolve — used to build an autocomplete datalist so
// sales sees valid options as they type.
export function knownColorNames(): string[] {
  return Array.from(
    new Set([...Object.keys(ALIASES), ...Object.keys(CSS_NAMES)]),
  ).sort();
}
