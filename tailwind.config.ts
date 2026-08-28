import type { Config } from "tailwindcss";

// ─── Fitoverse palette (design-system swap, 2026-08) ───────────────────────
// Pinned brand colours, expressed as full 50–950 ramps so BOTH the light tints
// (backgrounds) and the deep shades (text) hold contrast wherever an existing
// utility step is used. The mid step (500) is the exact pinned hex, mirrored
// as a CSS custom property in globals.css for the new component primitives.
//
//   ink   #0D2733  primary dark + body text          → neutral ramp (slate) anchor — now var(--tx)-driven, see below
//   turf  #2E7D4F  success / won / progress           → success role — matches --gd
//   court #00AEEF  info / links / PRIMARY action      → primary + accent role — matches --ac (was #1C6E8C)
//   track #B33A26  danger / lost / alerts             → danger role — matches --bd
//   mint  #7FD3A6  accent / highlight                 → legacy, near-unused after the sidebar accent moved to --ac
//
// These ramps are ALSO aliased onto Tailwind's `green`/`emerald`/`blue`/`red`
// keys so the thousands of existing raw `text-green-600` / `bg-blue-50` /
// `text-red-700` usages inherit the palette automatically — the same
// wholesale-remap trick the neutral `slate` ramp uses (slate now resolves to
// CSS variables instead of literal hex — see globals.css :root/html.dark).

const turf = {
  50: "#EAF5EE",
  100: "#CFE9D9",
  200: "#A6D6BB",
  300: "#74BE96",
  400: "#47A272",
  500: "#2E7D4F", // pinned turf
  600: "#276A44",
  700: "#205537",
  800: "#1A432C",
  900: "#133121",
  950: "#0A2015",
};

// Design-system swap (2026-08): court repointed from the old teal-blue
// #1C6E8C to the new accent #00AEEF (matches --ac in globals.css). Ramp
// recomputed (tint-toward-white 50-400 / shade-toward-black 600-950) so the
// ~200 direct court-* usages across the app repaint consistently with the
// wa.green/brand.blue alias, not just the alias itself.
const court = {
  50: "#F2FBFE",
  100: "#DEF4FD",
  200: "#B8E8FB",
  300: "#8CDBF8",
  400: "#4DC6F4",
  500: "#00AEEF", // pinned court — matches --ac
  600: "#0099D2",
  700: "#0081B1",
  800: "#00658B",
  900: "#004964",
  950: "#003143",
};

const track = {
  50: "#FBEBE7",
  100: "#F6D0C8",
  200: "#ECA99C",
  300: "#DF7C69",
  400: "#CC5440",
  500: "#B33A26", // pinned track
  600: "#9A3020",
  700: "#7C271A",
  800: "#611F15",
  900: "#471810",
  950: "#2C0E09",
};

const mint = {
  50: "#EFFBF4",
  100: "#D9F4E5",
  200: "#B4E9CB",
  300: "#7FD3A6", // pinned mint (accent)
  400: "#52BE87",
  500: "#33A06C",
  600: "#278155",
  700: "#216745",
  800: "#1C5238",
  900: "#16412D",
};

// Neutral ramp — now driven by CSS custom properties (globals.css :root /
// html.dark) instead of literal hex, so the ~140 files using bg-slate-*/
// text-slate-*/border-slate-* repaint automatically for both themes with zero
// JSX edits — the same "retarget the ramp" trick already used for green/blue/
// red above, extended to neutrals. Mapping grep-verified against real usage
// (bg vs border vs text dominance per shade — see the design-token plan):
//   50/100  -> --p2   (overwhelmingly background/hover-fill)
//   200/300 -> --line (overwhelmingly border/divider)
//   400/500 -> --dim  (overwhelmingly muted/secondary text)
//   600/700 -> --sub  (overwhelmingly secondary/body text)
//   800/900/950 -> --tx (overwhelmingly heading/primary text)
// Tailwind's own `white` key is deliberately left untouched (see globals.css
// dark-mode block) — remapping it would turn `text-white` on dark buttons
// into dark-grey text.
const slate = {
  50: "rgb(var(--p2) / <alpha-value>)",
  100: "rgb(var(--p2) / <alpha-value>)",
  200: "rgb(var(--line) / <alpha-value>)",
  300: "rgb(var(--line) / <alpha-value>)",
  400: "rgb(var(--dim) / <alpha-value>)",
  500: "rgb(var(--dim) / <alpha-value>)",
  600: "rgb(var(--sub) / <alpha-value>)",
  700: "rgb(var(--sub) / <alpha-value>)",
  800: "rgb(var(--tx) / <alpha-value>)",
  900: "rgb(var(--tx) / <alpha-value>)", // ink
  950: "rgb(var(--tx) / <alpha-value>)",
};

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      // App-wide text-only readability lift: each size renders a notch larger
      // than Tailwind's default so body copy is easier to read WITHOUT inflating
      // spacing/layout (padding/margin/gap utilities are unaffected). Only
      // xs/sm/base are overridden; lg and up keep their defaults. Root stays 17px.
      fontSize: {
        xs: ["0.8rem", { lineHeight: "1.1rem" }],
        sm: ["0.9375rem", { lineHeight: "1.35rem" }],
        base: ["1.0625rem", { lineHeight: "1.6rem" }],
      },
      fontFamily: {
        // Design-system swap (2026-08): body/UI font is now Poppins
        // (self-hosted, replaces Newsreader). `heading`/`display`/`sans` all
        // repoint to the SAME Poppins stack (rather than being deleted) so the
        // ~12 files using `font-heading` and 2 using `font-sans` need zero
        // JSX edits — they just resolve to the new font automatically.
        serif: [
          "Poppins",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        heading: ["Poppins", "system-ui", "-apple-system", "sans-serif"],
        display: ["Poppins", "system-ui", "-apple-system", "sans-serif"],
        sans: ["Poppins", "system-ui", "-apple-system", "sans-serif"],
        // ALL numbers, ₹ amounts, rates, counts, dates, codes — JetBrains Mono.
        // Unchanged — already matches the target design system's numeric role.
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      letterSpacing: {
        heading: "-0.01em",
      },
      // Design-system swap (2026-08): softened toward the new pill aesthetic
      // (was a near-square "industrial" scale). rounded-full stays circular.
      borderRadius: {
        none: "0",
        sm: "var(--r-sm)", // 6px
        DEFAULT: "8px",
        md: "var(--r-md)", // 10px
        lg: "var(--r-lg)", // 14px — matches .card
        xl: "var(--r-xl)", // 20px — matches .badge/.pill
        "2xl": "22px", // matches .btn
        "3xl": "28px", // unused today (0 occurrences) — safe headroom
        full: "9999px",
      },
      colors: {
        // `wa-*` is the app's PRIMARY action colour, used in 500+ places.
        // Repointed to COURT (info/link/primary) so every primary button, active
        // nav item and accent link reskins from here. Genuine WhatsApp green
        // stays on `waReal`, reserved for real WhatsApp affordances only.
        wa: {
          green: court[500], // primary action (court)
          dark: court[700], // hover / emphasis text
          light: court[50], // active background tint
        },
        waReal: "#25D366", // genuine WhatsApp green (reserved)

        // Named brand tokens, re-mapped onto the pinned palette + semantic roles.
        brand: {
          ink: slate[900], // text / ink
          blue: court[500], // info / link / primary  → court
          blueDeep: court[700],
          blueTint: court[50],
          green: turf[500], // success / won          → turf
          greenDeep: turf[700],
          greenTint: turf[50],
          red: track[500], // danger / lost          → track
          redDeep: track[700],
          redTint: track[50],
          mint: mint[300], // accent / highlight
          mintTint: mint[50],
          // Warning is orthogonal to the 5-colour system — kept as amber.
          amber: "#D9822B",
          amberTint: "#FBF0E2",
        },

        // Direct semantic ramps (preferred for new Phase-1 work).
        ink: {
          DEFAULT: slate[900],
          ...slate,
        },
        turf,
        court,
        track,
        mint,

        // Neutral ramp (ink-biased cool grey).
        slate,

        // Alias the raw Tailwind semantic ramps onto the palette so existing raw
        // utility usage (text-green-600, bg-blue-50, text-red-700, …) inherits
        // the new colours automatically.
        green: turf,
        emerald: turf,
        blue: court,
        red: track,
      },
      borderColor: {
        // Bare `border` (no colour utility) reads as a var(--line) hairline —
        // slate[300] already resolves to that token, kept for clarity.
        DEFAULT: "rgb(var(--line))",
      },
      ringColor: {
        DEFAULT: court[500], // now the new accent (--ac)
      },
    },
  },
  plugins: [],
};

export default config;
