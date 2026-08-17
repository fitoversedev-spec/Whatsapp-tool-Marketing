import type { Config } from "tailwindcss";

// ─── Fitoverse industrial palette ──────────────────────────────────────────
// Pinned brand colours, expressed as full 50–950 ramps so BOTH the light tints
// (backgrounds) and the deep shades (text) hold contrast wherever an existing
// utility step is used. The mid step (500) is the exact pinned hex.
//
//   ink   #0D2733  primary dark + body text          → neutral ramp (slate) anchor
//   turf  #2E7D4F  success / won / progress           → success role
//   court #1C6E8C  info / links / PRIMARY action      → primary + info role
//   track #B33A26  danger / lost / alerts             → danger role
//   mint  #7FD3A6  accent / highlight                 → accent role
//
// These ramps are ALSO aliased onto Tailwind's `green`/`emerald`/`blue`/`red`
// keys so the thousands of existing raw `text-green-600` / `bg-blue-50` /
// `text-red-700` usages inherit the new palette automatically — the same
// wholesale-remap trick the neutral `slate` ramp already uses.

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

const court = {
  50: "#E7F1F5",
  100: "#C7E0EA",
  200: "#98C6D7",
  300: "#61A6BF",
  400: "#3888A5",
  500: "#1C6E8C", // pinned court
  600: "#185D77",
  700: "#144B61",
  800: "#113C4E",
  900: "#0D2E3B",
  950: "#081E28",
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

// Neutral ramp — cool ink-biased grey. Lightness tracks Tailwind's slate so the
// 3,000+ existing slate usages keep their contrast; the DARK end lands exactly
// on ink (#0D2733) so `text-slate-900` == body ink.
const slate = {
  50: "#F4F7F8",
  100: "#E7EDEF",
  200: "#D5E0E3",
  300: "#B8C7CC",
  400: "#859398",
  500: "#566268",
  600: "#414D53",
  700: "#2E3A40",
  800: "#1B2A31",
  900: "#0D2733", // ink
  950: "#081A22",
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
        // Body copy — Newsreader (self-hosted serif). This is what the app
        // renders by default (see globals.css `html, body`).
        serif: [
          "Newsreader",
          "Iowan Old Style",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
        // Headings + CTAs — Archivo (self-hosted). Rendered UPPERCASE with tight
        // tracking via the base layer / `.heading` primitive.
        heading: ["Archivo", "Segoe UI", "system-ui", "Arial", "sans-serif"],
        display: ["Archivo", "Segoe UI", "system-ui", "Arial", "sans-serif"],
        // Opt-in UI sans (Manrope) — kept for chrome that prefers a grotesque
        // over the serif body (nav labels, dense controls).
        sans: [
          "Manrope",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        // ALL numbers, ₹ amounts, rates, counts, dates, codes — JetBrains Mono.
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
      // Industrial look — flatten rounding across the board. `rounded-full`
      // stays circular for avatars/dots; every other step collapses toward
      // near-square so the 1,000+ `rounded-lg/xl/2xl` usages read industrial.
      borderRadius: {
        none: "0",
        sm: "1px",
        DEFAULT: "2px",
        md: "3px",
        lg: "4px",
        xl: "6px",
        "2xl": "8px",
        "3xl": "10px",
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
        // Stronger default border for the industrial look — bare `border`
        // (no colour utility) now reads as a crisp slate-300 hairline.
        DEFAULT: slate[300],
      },
      ringColor: {
        DEFAULT: court[500],
      },
    },
  },
  plugins: [],
};

export default config;
