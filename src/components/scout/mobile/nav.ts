/**
 * The Field-mode menu sheet.
 *
 * The phone mockup does not use a tab bar — it uses a Menu pill that drops a
 * sheet listing the five screens, and every row is enabled or disabled
 * depending on whether there is a scan to look at. That "Results — Last scan"
 * hint in the mockup is doing real work: it tells the surveyor which scan the
 * row would open.
 *
 * Deliberately separate from `src/lib/nav.ts`. That file is the *desktop* top
 * nav (Dashboard / Area profile / Spaces sweep / Compare / My sites) and Phase
 * 4 owns it. Field mode is a different product with different destinations, and
 * forcing one list to serve both would mean one of them showing a row it cannot
 * navigate to.
 */

export interface FieldNavItem {
  readonly key: string;
  readonly label: string;
  /** Right-hand secondary text, as in the mockup ("Current", "12 saved"). */
  readonly hint: string;
  /** `null` when there is nothing to navigate to yet. */
  readonly href: string | null;
}

export interface FieldNavContext {
  /** The scan currently in view, if any. */
  readonly scanId?: string | null;
  /** The competitor currently in view, if any. */
  readonly placeId?: string | null;
  /** Shown as the hint on "My sites". */
  readonly savedCount?: number | null;
}

/**
 * Build the sheet's rows.
 *
 * A row with no destination is rendered disabled rather than hidden: a menu
 * whose contents change shape between screens is a menu people stop trusting.
 */
export function fieldNavItems(ctx: FieldNavContext = {}): FieldNavItem[] {
  const scanId = ctx.scanId ?? null;
  const placeId = ctx.placeId ?? null;
  const saved = ctx.savedCount;

  return [
    { key: "scan", label: "Site check", hint: "Current", href: "/scout/m/scan" },
    {
      key: "results",
      label: "Results",
      hint: scanId ? "Last scan" : "Run a scan first",
      href: scanId ? `/scout/m/scan/${scanId}` : null,
    },
    {
      key: "detail",
      label: "Competitor detail",
      hint: placeId ? "" : "Open one from results",
      href: placeId && scanId ? `/scout/m/place/${encodeURIComponent(placeId)}?scan=${scanId}` : null,
    },
    {
      key: "report",
      label: "Report & share",
      hint: "",
      href: scanId ? `/scout/m/report/${scanId}` : null,
    },
    {
      key: "sites",
      label: "My sites",
      hint: typeof saved === "number" ? `${saved} saved` : "Saved",
      href: "/scout/m/sites",
    },
  ];
}
