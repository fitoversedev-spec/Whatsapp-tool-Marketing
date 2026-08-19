import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/components/ThemeProvider";

// Industrial type system — Archivo (headings), Newsreader (body copy) and
// JetBrains Mono (all numbers). Self-hosted from /public/fonts via @font-face in
// globals.css (Manrope kept as the opt-in UI sans). We self-host rather than use
// next/font/google because that fetch stalls behind some networks/proxies here.

export const metadata: Metadata = {
  title: "Fitoverse",
  description: "Fitoverse — WhatsApp marketing, quotations, court designs and CRM in one tool",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1C6E8C",
};

// Inline script runs BEFORE React hydrates — applies the persisted theme so
// the first paint matches the user's choice (no light-mode flash).
const themeBootstrap = `
(function(){try{
  var t = localStorage.getItem('ccd_theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
}catch(e){}})();
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
