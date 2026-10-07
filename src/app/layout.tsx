import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/components/ThemeProvider";

// Type system — Poppins (UI/body/headings) and JetBrains Mono (all numbers).
// Self-hosted from /public/fonts via @font-face in globals.css. We self-host
// rather than use next/font/google because that fetch stalls behind some
// networks/proxies here.

export const metadata: Metadata = {
  title: "Fitoverse",
  description: "Fitoverse — WhatsApp marketing, quotations, court designs and CRM in one tool",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Fitoverse",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
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
