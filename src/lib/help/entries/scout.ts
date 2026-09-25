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
      { text: "View your saved sites and recent scan results" },
      { text: "Check the quick stats: total sites, scans this month, and pending analyses" },
      { text: "Click any site card to open its details or run an AI analysis" },
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
    summary: "Draw a scan area on the map to discover sports facilities, parks, and potential sites.",
    section: "scout",
    category: "Scanning",
    roles: ["admin"],
    keywords: ["scan", "area", "map", "discover", "sites"],
    steps: [
      { text: "Click **Scan Area** in the Scout sidebar", target: "scout-sidebar-scan" },
      { text: "Draw a rectangle or polygon on the map to define the area" },
      { text: "Click **Start Scan** — the system searches for facilities within the area", target: "scout-start-scan" },
      { text: "Results appear as pins on the map; click a pin to view details" },
    ],
    screenshot: {
      path: "/scout/scan",
      file: "scout-scan-area.png",
      alt: "Scout scan page with area selection on map",
    },
  },

  // ── Discovery ──────────────────────────────────────────
  {
    slug: "find-spaces",
    title: "How to find spaces (Sweep)",
    summary: "Automatically sweep a larger area to discover open plots and available spaces for development.",
    section: "scout",
    category: "Discovery",
    roles: ["admin"],
    keywords: ["sweep", "find", "spaces", "open", "plot", "discover", "available"],
    steps: [
      { text: "Click **Find Spaces** in the Scout sidebar", target: "scout-sidebar-sweep" },
      { text: "Select the area on the map to sweep" },
      { text: "Set your search criteria: minimum area size, land type, proximity to roads" },
      { text: "Click **Start Sweep** — the system scans for available spaces" },
      { text: "Review results and save promising locations to your Saved Scans" },
    ],
    screenshot: {
      path: "/scout/sweep",
      file: "scout-find-spaces.png",
      alt: "Find Spaces page with sweep area on map",
    },
  },

  // ── Comparison ─────────────────────────────────────────
  {
    slug: "compare-sites",
    title: "How to compare sites",
    summary: "Put two or more saved sites side by side to compare scores, demographics, and facilities.",
    section: "scout",
    category: "Comparison",
    roles: ["admin"],
    keywords: ["compare", "sites", "side-by-side", "score", "demographics"],
    steps: [
      { text: "Click **Compare** in the Scout sidebar", target: "scout-sidebar-compare" },
      { text: "Select 2 or more saved sites to compare" },
      { text: "View the side-by-side comparison: scores, nearby facilities, demographics" },
      { text: "Identify which site has the best potential based on the scoring breakdown" },
    ],
    screenshot: {
      path: "/scout/compare",
      file: "scout-compare.png",
      alt: "Compare page with side-by-side site scoring",
    },
  },

  // ── Management ─────────────────────────────────────────
  {
    slug: "saved-scans",
    title: "How to manage saved scans",
    summary: "View, organize, and manage all your saved scan results and favorite sites.",
    section: "scout",
    category: "Management",
    roles: ["admin"],
    keywords: ["saved", "scans", "manage", "favorite", "sites", "organize"],
    steps: [
      { text: "Click **Saved Scans** in the Scout sidebar", target: "scout-sidebar-sites" },
      { text: "Browse your saved sites with their scores and scan dates" },
      { text: "Click the **star icon** to favorite important sites" },
      { text: "Click a site to view full details, scan results, and run AI analysis" },
      { text: "Use **Delete** to remove sites you no longer need" },
    ],
    screenshot: {
      path: "/scout/sites",
      file: "scout-saved-scans.png",
      alt: "Saved scans page with site list and scores",
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
      { text: "From the **Dashboard** or **Saved Scans**, click on a saved site" },
      { text: "Click **Run AI Analysis** on the site detail card", target: "scout-ai-analyze" },
      { text: "Choose the analysis type: Quick, Standard, or Comprehensive" },
      { text: "Wait for the report to generate (30-90 seconds), then review the findings" },
    ],
    screenshot: {
      path: "/scout/dashboard",
      file: "scout-ai-analysis.png",
      alt: "Scout dashboard with AI analysis button highlighted",
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
      { text: "View all generated reports sorted by date" },
      { text: "Click a report to open the full analysis with charts and recommendations" },
      { text: "Click **Download PDF** to save the report for sharing" },
      { text: "Use the **Share** button to send the report link to stakeholders" },
    ],
    screenshot: {
      path: "/scout/reports",
      file: "scout-reports.png",
      alt: "Reports page with downloadable analysis PDFs",
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
      { text: "Open **Scoring** to adjust scoring weights for different factors" },
      { text: "Open **Users** to manage who has access to Scout" },
      { text: "Monitor scan counts and API usage from the settings overview" },
    ],
    screenshot: {
      path: "/scout/admin",
      file: "scout-settings.png",
      alt: "Scout settings page with scoring configuration",
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
      { text: "Save promising sites to your collection or run AI analysis on them" },
    ],
    screenshot: {
      path: "/scout/scan",
      file: "scout-scan-results.png",
      alt: "Scan results page with discovered sites on map",
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
      { text: "Read the executive summary and key findings" },
      { text: "Review charts showing demographics, competition, and demand" },
      { text: "Scroll to the **Recommendations** section for actionable next steps" },
      { text: "Click **Download PDF** to save the report for sharing" },
    ],
    screenshot: {
      path: "/scout/reports",
      file: "scout-report-detail.png",
      alt: "Full report detail page with charts and recommendations",
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
      { text: "Use **Scan** to scan a new area from the field" },
      { text: "View **My Sites** to see all your saved locations" },
      { text: "Tap a site to view details, run AI analysis, or check reports" },
    ],
    screenshot: {
      path: "/scout/m/scan",
      file: "scout-mobile.png",
      alt: "Scout mobile app showing scan interface on phone",
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
      { text: "Previously viewed sites and scan results remain accessible" },
      { text: "New scans and analyses are queued and will sync when you reconnect" },
      { text: "An **offline banner** appears at the top to indicate limited connectivity" },
    ],
    screenshot: {
      path: "/scout/m/offline",
      file: "scout-offline.png",
      alt: "Scout mobile app in offline mode with cached data",
    },
  },

  // ── Additional Admin Guides ───────────────────────────
  {
    slug: "scout-manage-users",
    title: "How to manage Scout users",
    summary: "Add, remove, or update team members who have access to the Site Scout tool.",
    section: "scout",
    category: "Admin",
    roles: ["admin"],
    keywords: ["users", "team", "access", "manage", "scout", "admin"],
    steps: [
      { text: "Click **Settings** in the Scout sidebar (admin only)", target: "scout-sidebar-admin" },
      { text: "Navigate to the **Users** tab" },
      { text: "View all team members with their access level and last active date", target: "scout-users-list" },
      { text: "Click **+ Add User** to grant a team member access to Scout" },
      { text: "Click the **remove icon** next to a user to revoke their Scout access" },
    ],
    screenshot: {
      path: "/scout/admin/users",
      file: "scout-manage-users.png",
      alt: "Scout users management page",
    },
  },
  {
    slug: "scout-scoring",
    title: "How to configure scoring weights",
    summary: "Adjust how different factors (demographics, competition, accessibility) contribute to site scores.",
    section: "scout",
    category: "Admin",
    roles: ["admin"],
    keywords: ["scoring", "weights", "configure", "factors", "demographics", "competition"],
    steps: [
      { text: "Click **Settings** in the Scout sidebar (admin only)", target: "scout-sidebar-admin" },
      { text: "Navigate to the **Scoring** tab" },
      { text: "View the current weight for each scoring factor" },
      { text: "Drag the sliders to adjust weights (e.g., increase demographics, decrease competition)", target: "scout-scoring-sliders" },
      { text: "Click **Save** — all existing and future site scores will recalculate" },
    ],
    screenshot: {
      path: "/scout/admin/scoring",
      file: "scout-scoring.png",
      alt: "Scoring weights configuration with factor sliders",
    },
  },
  {
    slug: "scout-usage",
    title: "How to view Scout usage stats",
    summary: "Monitor scan counts, API requests, and usage trends across your team.",
    section: "scout",
    category: "Admin",
    roles: ["admin"],
    keywords: ["usage", "stats", "scans", "API", "requests", "monitor"],
    steps: [
      { text: "Click **Settings** in the Scout sidebar (admin only)", target: "scout-sidebar-admin" },
      { text: "Navigate to the **Usage** tab" },
      { text: "View total scans, API requests, and AI analyses this month", target: "scout-usage-chart" },
      { text: "Check usage trends over time with the monthly chart" },
      { text: "Monitor per-user usage to ensure fair distribution of resources" },
    ],
    screenshot: {
      path: "/scout/admin/usage",
      file: "scout-usage.png",
      alt: "Scout usage stats page with scan counts and trends",
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
