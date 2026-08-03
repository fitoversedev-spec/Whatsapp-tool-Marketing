import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/components/ThemeProvider";

// Brand UI font — Manrope (free, readable geometric sans; the approved Gilroy
// stand-in). Self-hosted from /public/fonts via @font-face in globals.css — no
// build-time network fetch (next/font/google's fetch stalls in some networks).

export const metadata: Metadata = {
  title: "Fitoverse",
  description: "Fitoverse — WhatsApp marketing, quotations, court designs and CRM in one tool",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#159341",
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
