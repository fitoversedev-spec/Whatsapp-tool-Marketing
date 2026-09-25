import type { GuideEntry, SectionRecording } from "../types";

export const SCOUT_ENTRIES: GuideEntry[] = [
  // ── Dashboard ──────────────────────────────────────────
  {
    slug: "scout-dashboard",
    title: "How to use the Scout Dashboard",
    summary: "View saved sites, recent scans, and quick stats at a glance from the main dashboard.",
    section: "scout",
    category: "Dashboard",
    roles: ["admin"],
    keywords: ["dashboard", "overview", "sites", "scans", "stats"],
    steps: [
      { text: "Click **Dashboard** in the Scout sidebar", target: "scout-sidebar-dashboard" },
      { text: "View your saved sites and recent scan results", target: "scout-dashboard-card" },
      { text: "Check the summary under the title: how many areas were scanned this month and by how many salespeople", target: "scout-dashboard-summary" },
      { text: "Click any site card to open its results and create a report" },
    ],
    screenshot: {
      path: "/scout/dashboard",
      file: "scout-dashboard.png",
      alt: "Scout Dashboard with saved sites and quick stats",
    },
  },

  // ── Scanning ───────────────────────────────────────────
  {
    slug: "scan-area",
    title: "How to scan an area",
    summary: "Pin a plot on the map, choose a radius and the sports to look for, and scan for nearby facilities and competition.",
    section: "scout",
    category: "Scanning",
    roles: ["admin"],
    keywords: ["scan", "area", "map", "discover", "sites"],
    steps: [
      { text: "Click **Scan Area** in the Scout sidebar", target: "scout-sidebar-scan" },
      { text: "Enter the plot's address, landmark, or Google Maps link — or drag the pin on the map onto the exact plot", target: "scout-scan-address" },
      { text: "Set the **radius** to scan around the plot", target: "scout-scan-radius" },
      { text: "Pick the **sports** to look for", target: "scout-scan-sports" },
      { text: "Click **Run scan** — the system searches for facilities around the plot", target: "scout-start-scan" },
      { text: "Results appear as pins on the map; click a pin to view details" },
    ],
    screenshot: {
      path: "/scout/scan",
      file: "scout-scan-area.png",
      alt: "Scout scan page with address, radius, sports and the Run scan button highlighted",
      setup: [{ type: "wait", duration: 8000 }],
      viewport: { width: 1440, height: 1100 },
    },
  },

  // ── Discovery ──────────────────────────────────────────
  {
    slug: "find-spaces",
    title: "How to find spaces (Sweep)",
    summary: "Explore the map to find and check promising locations, then scan them for nearby facilities.",
    section: "scout",
    category: "Discovery",
    roles: ["admin"],
    keywords: ["sweep", "find", "spaces", "open", "plot", "discover", "available"],
    steps: [
      { text: "Click **Find Spaces** in the Scout sidebar", target: "scout-sidebar-sweep" },
      { text: "Search for a place or city in the search box on the map", target: "scout-sweep-search" },
      { text: "Or right-click any point on the map to get its address and surrounding details", target: "scout-sweep-hint" },
      { text: "Check the details panel — address, Street View, and a link to the place on Google Maps" },
      { text: "If the location looks promising, click **Scan this area** to check nearby facilities, demand, and competition" },
    ],
    screenshot: {
      path: "/scout/sweep",
      file: "scout-find-spaces.png",
      alt: "Find Spaces page with the map search box and right-click hint",
    },
  },

  // ── Comparison ─────────────────────────────────────────
  {
    slug: "compare-sites",
    title: "How to compare sites",
    summary: "Put two or three saved scans side by side to compare scores, facilities, and demand.",
    section: "scout",
    category: "Comparison",
    roles: ["admin"],
    keywords: ["compare", "sites", "side-by-side", "score", "demographics"],
    steps: [
      { text: "Click **Compare** in the Scout sidebar", target: "scout-sidebar-compare" },
      { text: "Pick two or three saved scans by clicking their cards", target: "scout-compare-card" },
      { text: "View the side-by-side comparison table — the best value in each row is highlighted", target: "scout-compare-table" },
      { text: "Identify which site has the best potential based on the scoring breakdown" },
    ],
    screenshot: {
      path: "/scout/compare",
      file: "scout-compare.png",
      alt: "Compare page with two scans selected and the side-by-side table",
      setup: [
        { type: "click", selector: '[data-guide="scout-compare-card"]:nth-of-type(1)' },
        { type: "wait", duration: 6000 },
        { type: "click", selector: '[data-guide="scout-compare-card"]:nth-of-type(2)' },
      ],
      viewport: { width: 1440, height: 1500 },
    },
  },

  // ── Management ─────────────────────────────────────────
  {
    slug: "saved-scans",
    title: "How to manage saved scans",
    summary: "View, open, and remove all your saved scan results.",
    section: "scout",
    category: "Management",
    roles: ["admin"],
    keywords: ["saved", "scans", "manage", "favorite", "sites", "organize"],
    steps: [
      { text: "Click **Saved Scans** in the Scout sidebar", target: "scout-sidebar-sites" },
      { text: "Browse your saved sites with their scores and scan dates", target: "scout-sites-row" },
      { text: "Use **New site check** at the top right to start another scan", target: "scout-sites-new" },
      { text: "Click a site to view its full results and create a report" },
      { text: "Hover a row and click the **trash icon**, then **Delete**, to remove scans you no longer need", target: "scout-sites-archive" },
    ],
    screenshot: {
      path: "/scout/sites",
      file: "scout-saved-scans.png",
      alt: "Saved scans page with the scan list, New site check button and the archive icon",
      setup: [{ type: "hover", selector: '[data-guide="scout-sites-row"]' }],
    },
  },

  // ── Analysis ───────────────────────────────────────────
  {
    slug: "ai-analysis",
    title: "How to run AI analysis on a site",
    summary: "Get an AI-powered feasibility report for a specific location, including demand, competition, and recommendations.",
    section: "scout",
    category: "Analysis",
    roles: ["admin"],
    keywords: ["ai", "analysis", "report", "feasibility", "site"],
    steps: [
      { text: "From the **Dashboard** or **Saved Scans**, click on a saved site", target: "scout-dashboard-card" },
      { text: "Click **Run AI Analysis** on the site detail card" },
      { text: "Choose the analysis type: Quick, Standard, or Comprehensive" },
      { text: "Wait for the report to generate (30-90 seconds), then review the findings" },
    ],
    screenshot: {
      path: "/scout/dashboard",
      file: "scout-ai-analysis.png",
      alt: "Scout dashboard with a saved site card highlighted",
    },
  },

  // ── Reports ────────────────────────────────────────────
  {
    slug: "scout-reports",
    title: "How to view and download reports",
    summary: "Access all generated analysis reports, download PDFs, and share with stakeholders.",
    section: "scout",
    category: "Reports",
    roles: ["admin"],
    keywords: ["report", "download", "pdf", "share", "analysis"],
    steps: [
      { text: "Click **Reports** in the Scout sidebar", target: "scout-sidebar-reports" },
      { text: "View all generated reports sorted by date", target: "scout-reports-row" },
      { text: "Click a report to open the full analysis with charts and recommendations" },
      { text: "Inside a report, click **Open the PDF** to save it for sharing" },
      { text: "Use the **Send** button on a row to share the report link on WhatsApp", target: "scout-reports-send" },
    ],
    screenshot: {
      path: "/scout/reports",
      file: "scout-reports.png",
      alt: "Reports page with the report list and Send buttons",
    },
  },

  // ── Admin ──────────────────────────────────────────────
  {
    slug: "scout-settings",
    title: "How to configure Scout settings",
    summary: "Adjust scoring weights, manage user access, and monitor scan usage.",
    section: "scout",
    category: "Admin",
    roles: ["admin"],
    keywords: ["settings", "scoring", "config", "admin", "usage"],
    steps: [
      { text: "Click **Settings** in the Scout sidebar (admin only)", target: "scout-sidebar-admin" },
      { text: "Open **Scoring** to adjust scoring weights for different factors", target: "scout-admin-tab-scoring" },
      { text: "Open **Users** to manage who has access to Scout", target: "scout-admin-tab-users" },
      { text: "Open **Usage** to monitor scan counts and API costs", target: "scout-admin-tab-usage" },
    ],
    screenshot: {
      path: "/scout/admin",
      file: "scout-settings.png",
      alt: "Scout settings with the Users, Scoring and Usage tabs highlighted",
    },
  },

  // ── Filter Guides ──────────────────────────────────────
  {
    slug: "filter-scout-dashboard",
    title: "How to filter and sort saved sites",
    summary: "Search saved sites by area, customer, or owner and sort by score, date, or name.",
    section: "scout",
    category: "Dashboard",
    roles: ["admin"],
    keywords: ["filter", "sort", "search", "dashboard", "sites", "score", "date"],
    steps: [
      { text: "Click **Dashboard** in the Scout sidebar", target: "scout-sidebar-dashboard" },
      { text: "Type in the **search bar** to find sites by area name, customer, or owner", target: "scout-dashboard-search" },
      { text: "Use the **Sort dropdown** to order by: Newest first, Site score, or Area name", target: "scout-dashboard-sort" },
      { text: "Results update instantly as you type or change the sort order" },
    ],
    screenshot: {
      path: "/scout/dashboard",
      file: "scout-filter-dashboard.png",
      alt: "Scout dashboard with search bar and sort dropdown",
    },
  },

  // ── Scanning Detail ───────────────────────────────────
  {
    slug: "scout-scan-results",
    title: "How to view scan results",
    summary: "Review the detailed results of a completed area scan, including discovered sites and scores.",
    section: "scout",
    category: "Scanning",
    roles: ["admin"],
    keywords: ["scan", "results", "detail", "sites", "discovered", "score"],
    steps: [
      { text: "After running a scan, click on the scan notification or go to **Saved Scans**", target: "scout-sidebar-sites" },
      { text: "Click a scan to open its results page" },
      { text: "View discovered sites plotted on the map with score indicators", target: "scout-scan-map" },
      { text: "Click individual site pins to see their score breakdown" },
      { text: "Scroll the results list and click **Compute the site score** to score the plot", target: "scout-compute-score" },
    ],
    screenshot: {
      path: "/scout/sites",
      file: "scout-scan-results.png",
      alt: "Scan results page with discovered places on the map and the Compute the site score button",
      setup: [
        { type: "click", selector: '[data-guide="scout-sites-row"]' },
        { type: "wait", duration: 8000 },
      ],
      viewport: { width: 1440, height: 1100 },
    },
  },

  // ── Report Detail ─────────────────────────────────────
  {
    slug: "scout-report-detail",
    title: "How to view a report in detail",
    summary: "Read the full AI-generated analysis report with charts, recommendations, and scoring.",
    section: "scout",
    category: "Reports",
    roles: ["admin"],
    keywords: ["report", "detail", "analysis", "charts", "recommendations", "full"],
    steps: [
      { text: "Go to **Reports** in the Scout sidebar", target: "scout-sidebar-reports" },
      { text: "Click on a report row to open its full detail page" },
      { text: "Read the executive summary and key findings", target: "scout-report-summary" },
      { text: "Review charts showing demographics, competition, and demand" },
      { text: "Scroll to the **Recommendations** section for actionable next steps" },
      { text: "Click **Open the PDF** to save the report for sharing", target: "scout-report-download" },
    ],
    screenshot: {
      path: "/scout/reports",
      file: "scout-report-detail.png",
      alt: "Report studio with the report preview and the Open the PDF button",
      setup: [{ type: "click", selector: '[data-guide="scout-reports-row"]' }],
    },
  },

  // ── Mobile ────────────────────────────────────────────
  {
    slug: "scout-mobile",
    title: "How to use Scout on mobile",
    summary: "Use the Scout field app on your phone to scan areas, view sites, and run analyses on the go.",
    section: "scout",
    category: "Mobile",
    roles: ["admin"],
    keywords: ["mobile", "field", "app", "phone", "scan", "on the go"],
    steps: [
      { text: "Open **/scout/m** on your phone's browser to access the field app" },
      { text: "Install it to your home screen for quick access (see the install guide)" },
      { text: "Tap **Use my current location** (or search an address) to set the plot", target: "scout-m-location" },
      { text: "Pick a scan radius and tap **Run scan**", target: "scout-m-run-scan" },
      { text: "Open the **Menu** and choose **My sites** to see all your saved locations", target: "scout-m-menu" },
      { text: "Tap a site to view its results and reports" },
    ],
    screenshot: {
      path: "/scout/m/scan",
      file: "scout-mobile.png",
      alt: "Scout mobile app showing the site check screen on a phone",
      viewport: { width: 390, height: 844 },
    },
  },
  {
    slug: "scout-offline",
    title: "How to use Scout offline",
    summary: "Access previously loaded scan data and site details even without internet connectivity.",
    section: "scout",
    category: "Mobile",
    roles: ["admin"],
    keywords: ["offline", "no internet", "cached", "field", "connectivity"],
    steps: [
      { text: "Open the Scout mobile app and load the sites you need while online" },
      { text: "When you lose connectivity, the app switches to **offline mode** automatically" },
      { text: "Previously opened sites and scan results remain readable", target: "scout-offline-sites" },
      { text: "**Nothing is queued** — anything you record while offline tells you it did not save, so enter it again once you have signal", target: "scout-offline-queue" },
      { text: "The top of the screen shows **Offline** and **No network** while you have no connectivity", target: "scout-m-status" },
    ],
    screenshot: {
      path: "/scout/m/offline",
      file: "scout-offline.png",
      alt: "Scout mobile app in offline mode with the no-signal message",
      viewport: { width: 390, height: 844 },
    },
  },

  // ── Additional Admin Guides ───────────────────────────
  {
    slug: "scout-manage-users",
    title: "How to manage Scout users",
    summary: "Approve new sign-ups and see everyone who has access to the Site Scout tool.",
    section: "scout",
    category: "Admin",
    roles: ["admin"],
    keywords: ["users", "team", "access", "manage", "scout", "admin"],
    steps: [
      { text: "Click **Settings** in the Scout sidebar (admin only)", target: "scout-sidebar-admin" },
      { text: "Navigate to the **Users** tab", target: "scout-admin-tab-users" },
      { text: "New sign-ups appear under **Waiting for approval**", target: "scout-users-pending" },
      { text: "Click **Approve** to give someone access, or **Reject** to decline the request" },
      { text: "**Everyone else** lists every team member with their role and approval status", target: "scout-users-list" },
    ],
    screenshot: {
      path: "/scout/admin/users",
      file: "scout-manage-users.png",
      alt: "Scout users page with the waiting-for-approval list and everyone else",
    },
  },
  {
    slug: "scout-scoring",
    title: "How to configure scoring weights",
    summary: "Adjust how different factors contribute to site scores.",
    section: "scout",
    category: "Admin",
    roles: ["admin"],
    keywords: ["scoring", "weights", "configure", "factors", "demographics", "competition"],
    steps: [
      { text: "Click **Settings** in the Scout sidebar (admin only)", target: "scout-sidebar-admin" },
      { text: "Navigate to the **Scoring** tab", target: "scout-admin-tab-scoring" },
      { text: "View the current weight for each scoring factor — the points must total 100", target: "scout-scoring-sliders" },
      { text: "Click **Edit Weights**, then drag the sliders to adjust the weights (e.g., increase Demand Anchors)", target: "scout-scoring-edit" },
      { text: "Click **Save as New Version** — saving creates a new scoring model version" },
    ],
    screenshot: {
      path: "/scout/admin/scoring",
      file: "scout-scoring.png",
      alt: "Scoring weights configuration with factor sliders and the Edit Weights button",
      viewport: { width: 1440, height: 1100 },
    },
  },
  {
    slug: "scout-usage",
    title: "How to view Scout usage stats",
    summary: "Monitor scan counts, API calls, and estimated costs across your team.",
    section: "scout",
    category: "Admin",
    roles: ["admin"],
    keywords: ["usage", "stats", "scans", "API", "requests", "monitor"],
    steps: [
      { text: "Click **Settings** in the Scout sidebar (admin only)", target: "scout-sidebar-admin" },
      { text: "Navigate to the **Usage** tab", target: "scout-admin-tab-usage" },
      { text: "View total scans, API calls, estimated cost, and cache hit rate for the last 30 days", target: "scout-usage-chart" },
      { text: "Scroll to **Per team member** to see each person's scans, API calls, estimated cost, and last scan", target: "scout-usage-table" },
    ],
    screenshot: {
      path: "/scout/admin/usage",
      file: "scout-usage.png",
      alt: "Scout usage page with summary cards and the per-team-member table",
    },
  },
];

export const SCOUT_RECORDING: SectionRecording = {
  slug: "scout-overview",
  title: "Site Scout Overview",
  section: "scout",
  startUrl: "/scout/dashboard",
  actions: [
    { type: "caption", text: "Site Scout — find the best locations for sports facilities using maps, data, and AI", duration: 3000 },

    { type: "caption", text: "Dashboard — all your saved sites with scores, recent scans, and comparison tools" },
    { type: "wait", duration: 2500 },
    { type: "caption", text: "Each site card shows the area name, facility count, demand score, and AI rating" },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "Scan Area — draw a rectangle on the map to discover sports facilities, parks, and open spaces nearby" },
    { type: "highlight", selector: "[data-guide='scout-sidebar-scan']", label: "Scan Area" },
    { type: "click", selector: "[data-guide='scout-sidebar-scan']" },
    { type: "wait", duration: 2500 },
    { type: "caption", text: "Results appear as pins on the map — click any pin to see its details and score breakdown" },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "Saved Scans — all your bookmarked sites organized by date, score, and area" },
    { type: "click", selector: "[data-guide='scout-sidebar-sites']" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "Compare 2 or more sites side-by-side to decide which location has the best potential" },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "Reports — AI-generated feasibility reports with demographics, competition, and recommendations" },
    { type: "highlight", selector: "[data-guide='scout-sidebar-reports']", label: "Reports" },
    { type: "click", selector: "[data-guide='scout-sidebar-reports']" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "Download reports as PDF to share with stakeholders and investors" },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "Admin can configure scoring weights, manage users, and monitor usage — see detailed guides below", duration: 3000 },
  ],
};
