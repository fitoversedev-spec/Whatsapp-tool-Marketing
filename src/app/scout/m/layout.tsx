import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { ServiceWorker } from "@/components/scout/mobile";
import { getScoutIdentity } from "@/lib/scout/identity";

import "./mobile.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Scout — Field mode",
  appleWebApp: {
    capable: true,
    title: "Site Scout",
    // Matches the dark header, so iOS does not draw a white band above it.
    statusBarStyle: "black-translucent",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
  /**
   * `viewport-fit: cover` is what makes `env(safe-area-inset-*)` report real
   * numbers. Without it the insets are zero and the sticky CTA sits under the
   * home indicator — the exact problem the mockup's hardcoded 22px was working
   * around.
   */
  viewportFit: "cover",
  /**
   * Zoom is left enabled deliberately. Pinch-to-zoom is a WCAG 1.4.4
   * requirement and `maximum-scale=1` is the single most common accessibility
   * defect in mobile web apps. The layout has no horizontal scroll at 320px, so
   * zooming costs nothing.
   */
  userScalable: true,
};

/**
 * Field mode.
 *
 * ## Why this is its own route group and not `(app)`
 *
 * `(app)` renders `AppShell`: a desktop top nav plus a responsive mobile
 * header. This is not that. The phone design is a distinct product — "Field
 * mode", one job per screen, a sticky primary action at the bottom of each —
 * and the brief is explicit that it must not be a shrunken desktop. Sharing a
 * shell would force every future change to one to be negotiated against the
 * other.
 *
 * What *is* shared: the design tokens, the `ui/` components, `<SiteMap />`, the
 * API layer and every line of scoring. Nothing here forks logic.
 *
 * ## Auth
 *
 * The same authoritative gate as `(app)/layout.tsx`. Edge middleware only
 * checks that a cookie exists; this runs on Node, resolves the identity through
 * `@/lib/scout/identity` and is what actually keeps non-active accounts out. See that
 * layout for why there is no longer a `status` branch here.
 */
export default async function FieldLayout({ children }: { children: ReactNode }) {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");

  return (
    <>
      <ServiceWorker />
      {children}
    </>
  );
}
