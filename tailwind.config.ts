import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Manrope",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        // `wa-*` is the app's primary action color, used in 500+ places. Repointed
        // from WhatsApp green to the Fitoverse BRAND green so the whole app reskins
        // from here. True WhatsApp green lives on `waReal`, used only on genuine
        // WhatsApp affordances (inbox send, "send on WhatsApp", the chat bubble).
        wa: {
          green: "#159341", // brand green (primary)
          dark: "#0C6E2E", // deep green — hover / emphasis text
          light: "#EAF5EE", // pale green tint — active backgrounds
        },
        waReal: "#25D366", // genuine WhatsApp green (reserved)
        // Brand accent + semantic tokens (Fitoverse brand guidelines).
        brand: {
          blue: "#73CAF0",
          blueDeep: "#2E9BD6",
          blueTint: "#EAF6FC",
          green: "#159341",
          greenDeep: "#0C6E2E",
          greenTint: "#EAF5EE",
          red: "#C81124",
          redTint: "#F4E6E8",
          amber: "#D9822B",
          amberTint: "#FBF0E2",
        },
        // Warm the neutral ramp: override Tailwind's cold `slate` with a subtly
        // green-biased gray so all 3,000+ slate usages match the mockups at once.
        // Lightness tracks the original slate steps so existing contrast holds.
        slate: {
          50: "#F5F8F6",
          100: "#EAF0EC",
          200: "#DDE7E1",
          300: "#C6D3CB",
          400: "#93A29A",
          500: "#5E6F66",
          600: "#48574F",
          700: "#35433B",
          800: "#22302A",
          900: "#10241A",
          950: "#0A1712",
        },
      },
    },
  },
  plugins: [],
};

export default config;
