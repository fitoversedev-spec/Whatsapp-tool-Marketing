import type { GuideEntry, ScreenshotSetupAction, SectionRecording } from "../types";

// A click on server-rendered markup that has not hydrated yet does nothing (happens right after the dev
// server recompiles a page), so every setup that clicks starts with a short wait.
const HYDRATE: ScreenshotSetupAction = { type: "wait", duration: 3000 };

// The database behind the dev server holds real customers, so every capture that lists or opens people
// blurs their names, phone numbers, emails and notes. Labels, buttons, tabs and headings stay sharp.
const BLUR_CONTACT_TABLE = [
  ".data-table tbody td:nth-child(2)", // Name
  ".data-table tbody td:nth-child(3)", // Company (a solo customer's own name)
  ".data-table tbody td:nth-child(5)", // Phone
  ".data-table tbody td:nth-child(6)", // Email
];
const BLUR_LEADS_TABLE = [".data-table tbody td:nth-child(-n+3)"]; // Name, Company, Phone
const BLUR_CONTACT_DETAIL = [
  '[data-guide="crm-contact-name"]',
  "#details .font-medium",
  "#details .whitespace-pre-wrap",
  '[data-guide="crm-contact-next-action"]',
  "#deals a",
  ...["quotations", "court-designs", "products", "open-activities", "closed-activities", "notes", "attachments"].map(
    (id) => `#${id} > :not(:first-child)`,
  ),
];

const BLUR_SEGMENT_TABLE = [".data-table tbody td:nth-child(1)"]; // Name (a solo customer's own name)
const BLUR_DEALS_TABLE = [".data-table tbody td:nth-child(2)", ".data-table tbody td:nth-child(3)"]; // Deal title, Account
const BLUR_COMPANY_DETAIL = [
  '[data-guide="crm-company-name"]',
  "#details .font-medium",
  "#details .text-slate-700",
  "#contacts a",
  "#deals a > div:first-child",
  "#activities > :not(:first-child)",
];
const BLUR_DEAL_DETAIL = [
  '[data-guide="crm-deal-title"] h1',
  '[data-guide="crm-deal-account"] > :not(h3)',
  '[data-guide="crm-deal-main"] span.text-slate-900',
  '[data-guide="crm-deal-activity"] > :not(:first-child)',
  '[data-guide="crm-deal-site-address"] span:last-child',
  '[data-guide="crm-deal-primary-contact"] span:last-child',
];
const BLUR_PIPELINE_CARDS = [".cursor-grab .min-w-0.flex-1", ".cursor-grab .line-clamp-2"]; // Card name / phone, last message
const BLUR_ACTIVITIES_TABLE = [
  ".data-table tbody td:nth-child(3)", // Activity (titles carry the customer's name)
  ".data-table tbody td:nth-child(4)", // Customer
  ".data-table tbody td:nth-child(5)", // Phone
  ".data-table tbody td:nth-child(8)", // Deal / company
];
const BLUR_QUOTATIONS_TABLE = [".data-table tbody td:nth-child(3)"]; // Customer name + phone
const BLUR_COURT_CARDS = [".card .line-clamp-1", ".card .leading-snug"]; // Customer name, phone

// Opens the first contact in the Contacts list by following its name link (read-only).
const OPEN_FIRST_CONTACT: ScreenshotSetupAction[] = [
  HYDRATE,
  { type: "click", selector: '.data-table tbody a[href^="/crm/contacts/"]' },
  { type: "wait", duration: 4000 },
];

export const CRM_ENTRIES: GuideEntry[] = [
  // ── Dashboard ──────────────────────────────────────────
  {
    slug: "crm-dashboard",
    title: "How to use the CRM Dashboard",
    summary: "Get an overview of KPIs, recent activity, pipeline summary, and quick actions.",
    section: "crm",
    category: "Dashboard",
    keywords: ["dashboard", "overview", "KPI", "pipeline", "summary", "crm"],
    steps: [
      { text: "Click **Dashboard** in the CRM sidebar", target: "crm-sidebar-crm" },
      { text: "Review the KPI cards at the top (quotations sent, quoted value, deals won, won value)", target: "crm-dashboard-kpis" },
      { text: "Check the **Recent Activity** section for latest updates" },
      { text: "Use the **quick action buttons** to jump to common tasks" },
    ],
    screenshot: {
      path: "/crm",
      file: "crm-dashboard.png",
      alt: "CRM Dashboard with KPI cards and recent activity",
      blur: [
        '[data-guide="crm-dashboard-movers"] span.text-slate-800', // Rep names
        '[data-guide="crm-dashboard-schedule"] .space-y-2.ml-1', // Customer names, reminder text, owners
      ],
    },
  },

  // ── Contacts ───────────────────────────────────────────
  {
    slug: "add-crm-contact",
    title: "How to add a CRM contact",
    summary: "Create a new contact in the CRM with company, designation, and lead source details.",
    section: "crm",
    category: "Contacts",
    keywords: ["contact", "add", "create", "new", "crm"],
    steps: [
      { text: "Go to **Contacts** in the CRM sidebar" },
      { text: "Click the **+ New Contact** button at the top-right", target: "crm-contact-new-dialog" },
      { text: "Fill in name, phone, email, designation, location, and lead source", target: "crm-contact-form-details" },
      { text: "Click **Create** — you land on the new contact's page", target: "crm-contact-form-create" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-add-contact.png",
      alt: "New contact form opened from the Contacts page, with the contact details section and the Create button",
      // Only opens the empty New contact form — nothing is typed or created. The form covers the whole page,
      // so the sidebar link and the + New Contact button that led here are hidden behind it.
      setup: [HYDRATE, { type: "click", selector: '[data-guide="crm-contact-create"]' }, { type: "wait", duration: 1000 }],
    },
  },
  {
    slug: "bulk-assign-contacts",
    title: "How to bulk-assign contacts to a rep",
    summary: "Select multiple contacts and reassign their owner in one step (admin only).",
    section: "crm",
    category: "Contacts",
    roles: ["admin"],
    keywords: ["assign", "owner", "bulk", "reassign", "sales rep"],
    steps: [
      { text: "Go to **Contacts** in the CRM sidebar", target: "crm-sidebar-contacts" },
      { text: "Tick the **checkboxes** next to each contact you want to reassign", target: "crm-contact-checkbox" },
      { text: "The action bar appears — find the **Reassign owner to...** dropdown", target: "crm-bulk-reassign" },
      { text: "Pick the target rep and click **Apply**", target: "crm-bulk-apply" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-bulk-assign.png",
      alt: "CRM contacts page with one contact ticked and the bulk action bar showing the Reassign owner dropdown",
      // Ticks the first row's checkbox so the bulk bar appears — no bulk action is clicked.
      setup: [HYDRATE, { type: "click", selector: '.data-table tbody input[type="checkbox"]' }, { type: "wait", duration: 800 }],
      blur: BLUR_CONTACT_TABLE,
    },
  },
  {
    slug: "crm-import",
    title: "How to import contacts from a spreadsheet",
    summary: "Bulk-load contacts, companies, leads, or deals from a CSV or Excel file.",
    section: "crm",
    category: "Contacts",
    roles: ["admin"],
    keywords: ["import", "csv", "excel", "spreadsheet", "bulk", "upload"],
    steps: [
      { text: "Open **Import** from the CRM All Tools menu", target: "crm-sidebar-all-tools" },
      { text: "Select what you're importing: Contacts, Companies, or Deals", target: "crm-import-targets" },
      { text: "Upload your CSV or Excel file", target: "crm-import-file" },
      { text: "Map each column to the matching field (name, phone, email, etc.)" },
      { text: "Review the preview and click **Import** to load the data" },
    ],
    screenshot: {
      path: "/crm/import",
      file: "crm-import.png",
      alt: "Import page showing the first step: choose what to import, then Choose file (the mapping and preview steps appear after a file is uploaded)",
    },
  },
  {
    slug: "customer-segments",
    title: "How to view customer segments",
    summary: "See contacts grouped by customer segment, business type, lead source, or city.",
    section: "crm",
    category: "Contacts",
    keywords: ["segment", "company", "group", "business", "city", "source"],
    steps: [
      { text: "Open **Customer Segments** from the CRM All Tools menu", target: "crm-sidebar-all-tools" },
      { text: "Browse segments grouped by business type, lead source, or city", target: "crm-segments-tabs" },
      { text: "Click a segment to see all contacts within it", target: "crm-segments-chips" },
      { text: "Use this view to identify your strongest market segments" },
    ],
    screenshot: {
      path: "/crm/companies",
      file: "crm-customer-segments.png",
      alt: "Customer segments page with the group-by tabs, segment chips with counts and the customer table",
      blur: BLUR_SEGMENT_TABLE,
    },
  },

  // ── Leads ──────────────────────────────────────────────
  {
    slug: "crm-leads",
    title: "How to manage CRM leads",
    summary: "View, filter, and progress leads through stages from new to qualified to converted.",
    section: "crm",
    category: "Leads",
    keywords: ["lead", "manage", "stage", "qualify", "convert", "funnel"],
    steps: [
      { text: "Click **Leads** in the CRM sidebar", target: "crm-sidebar-leads" },
      { text: "View leads organized by stage (New, Contacted, Qualified, etc.)" },
      { text: "Use the **filters** to narrow by source, date, or owner" },
      { text: "Click a lead to open their detail and update the stage", target: "crm-leads-row-link" },
      { text: "Click **Convert to Deal** on a lead to create its deal — its status becomes **Converted**", target: "crm-leads-convert" },
    ],
    screenshot: {
      path: "/crm/leads",
      file: "crm-leads.png",
      alt: "CRM leads list with each lead's status and the Convert to Deal button",
      blur: BLUR_LEADS_TABLE,
    },
  },

  // ── Deals ──────────────────────────────────────────────
  {
    slug: "create-deal",
    title: "How to create a deal",
    summary: "Attach a deal to a contact to track pipeline value, stage, and expected close date.",
    section: "crm",
    category: "Deals",
    keywords: ["deal", "create", "pipeline", "revenue", "stage"],
    steps: [
      { text: "Open a **contact's detail page** by clicking their name", target: "crm-contact-name" },
      { text: "Scroll to the **Deals** section and click the **+** button", target: "crm-contact-add-deal" },
      { text: "Enter deal name, value, expected close date, and funnel stage" },
      { text: "Click **Create deal** — the deal appears in both the contact view and the Pipeline board", target: "crm-deal-create-confirm" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-create-deal.png",
      alt: "Contact detail page with the New deal dialog open from the Deals section's + button",
      // Opens the first contact, then the + button's New deal dialog — Create deal is never clicked.
      setup: [...OPEN_FIRST_CONTACT, { type: "click", selector: '[data-guide="crm-contact-add-deal"]' }, { type: "wait", duration: 800 }],
      blur: [...BLUR_CONTACT_DETAIL, '[data-guide="crm-new-deal-dialog"] p'],
      viewport: { width: 1440, height: 1200 },
    },
  },
  {
    slug: "deals-list",
    title: "How to manage deals",
    summary: "View all deals in a table, filter by stage, owner, or value, and track progress.",
    section: "crm",
    category: "Deals",
    keywords: ["deals", "list", "filter", "stage", "value", "manage"],
    steps: [
      { text: "Click **Deals** in the CRM sidebar", target: "crm-sidebar-deals" },
      { text: "View all deals with their stage, value, owner, and close date", target: "crm-deals-columns" },
      { text: "Use **filters** to narrow by channel, owner, or date range", target: "crm-deals-filters" },
      { text: "Click a deal row to open its detail page with notes and activity log", target: "crm-deals-row-link" },
      { text: "Update the deal stage by picking a new stage from the row's **Stage** dropdown", target: "crm-deals-stage" },
    ],
    screenshot: {
      path: "/deals",
      file: "crm-deals-list.png",
      alt: "Deals list page with the filters, the Stage dropdown and the value column",
      blur: BLUR_DEALS_TABLE,
    },
  },

  // ── Pipeline ───────────────────────────────────────────
  {
    slug: "pipeline-board",
    title: "How to use the Pipeline board",
    summary: "Drag-and-drop deals across funnel stages on a visual Kanban board.",
    section: "crm",
    category: "Pipeline",
    keywords: ["pipeline", "kanban", "board", "drag", "drop", "stage", "funnel"],
    steps: [
      { text: "Click **Pipeline** in the CRM sidebar", target: "crm-sidebar-pipeline" },
      { text: "View deals arranged in columns by stage (Enquiry Received → Contacted / Qualified → Site Visit Done → … → Won)", target: "crm-pipeline-stage" },
      { text: "**Drag a deal card** from one column to another to change its stage", target: "crm-pipeline-card" },
      { text: "Click a deal card to open its detail page", target: "crm-pipeline-card-open" },
      { text: "Use the **filter bar** to show only specific owners or date ranges", target: "crm-pipeline-owner" },
    ],
    screenshot: {
      path: "/pipeline",
      file: "crm-pipeline.png",
      alt: "Pipeline Kanban board with deals organized by stage (names, phones and messages blurred)",
      blur: BLUR_PIPELINE_CARDS,
    },
  },

  // ── Reminders ──────────────────────────────────────────
  {
    slug: "crm-reminders",
    title: "How to use CRM reminders",
    summary: "Schedule follow-up reminders linked to CRM contacts and deals.",
    section: "crm",
    category: "Reminders",
    keywords: ["reminder", "follow-up", "schedule", "CRM", "task"],
    steps: [
      { text: "Click **Reminders** in the CRM sidebar", target: "crm-sidebar-reminders" },
      { text: "Click **+ New Reminder** at the top-right" },
      { text: "Select the contact or deal, set date/time, and add a note" },
      { text: "View upcoming reminders sorted by date" },
      { text: "Mark as **done** when completed — it moves to the completed tab" },
    ],
    screenshot: {
      path: "/crm/reminders",
      file: "crm-reminders.png",
      alt: "CRM reminders page showing the empty \"All caught up\" state (the test account has no reminders)",
    },
  },

  // ── Quotations & Invoices ──────────────────────────────
  {
    slug: "crm-quotations",
    title: "How to create a CRM quotation",
    summary: "Generate quotations linked to CRM contacts and deals, with sport-based rate calculation.",
    section: "crm",
    category: "Quotations",
    keywords: ["quotation", "quote", "CRM", "price", "rate", "send"],
    steps: [
      { text: "Click **Quotations** in the CRM sidebar", target: "crm-sidebar-quotations" },
      { text: "Click **+ New quotation** and link it to a contact", target: "wa-quote-new" },
      { text: "Select sport, area, surface type, and additional items" },
      { text: "Review the calculated total and click **Generate Preview →**" },
      { text: "Send the quotation to the client via WhatsApp or download as PDF", target: "wa-quote-send" },
    ],
    screenshot: {
      path: "/crm/quotations",
      file: "crm-quotations.png",
      alt: "CRM quotations list with the + New quotation button and each row's View PDF and Send actions (customer names and phones blurred)",
      blur: BLUR_QUOTATIONS_TABLE,
    },
  },
  {
    slug: "crm-invoices",
    title: "How to manage CRM invoices",
    summary: "Convert quotations to invoices, track payments, and export invoice PDFs.",
    section: "crm",
    category: "Invoices",
    keywords: ["invoice", "payment", "billing", "CRM", "track"],
    steps: [
      { text: "Open **Invoices** from the CRM All Tools menu", target: "crm-sidebar-all-tools" },
      { text: "View all invoices with amount, status, and linked contact", target: "wa-invoices-head" },
      { text: "Click **+ New Invoice** or convert an existing quotation" },
      { text: "Update payment status as payments come in (Issued → Partly paid → Paid)", target: "wa-invoices-status" },
      { text: "Click **Download PDF** to save or print" },
    ],
    screenshot: {
      path: "/crm/invoices",
      file: "crm-invoices.png",
      alt: "CRM invoices page with the search box, payment status filters and the invoice table (no invoices yet)",
    },
  },

  // ── Activities ─────────────────────────────────────────
  {
    slug: "crm-activities",
    title: "How to log activities",
    summary: "Record calls, meetings, emails, and notes to maintain a complete activity timeline.",
    section: "crm",
    category: "Activities",
    keywords: ["activity", "call", "meeting", "email", "note", "log", "timeline"],
    steps: [
      { text: "Click **Activities** in the CRM sidebar", target: "crm-sidebar-activities" },
      { text: "Click **+ Log Activity** at the top" },
      { text: "Choose the type: Call, Meeting, Email, or Note" },
      { text: "Select the linked contact, add details, and set the date" },
      { text: "Click **Save** — the activity appears in both the list and the contact's timeline" },
    ],
    screenshot: {
      path: "/crm/activities",
      file: "crm-activities.png",
      alt: "Activities page with logged calls and meetings (customer names and phones blurred)",
      blur: BLUR_ACTIVITIES_TABLE,
    },
  },

  // ── Insights ───────────────────────────────────────────
  {
    slug: "crm-insights",
    title: "How to use CRM Insights",
    summary: "Get AI-powered insights and recommendations for your contacts and deals.",
    section: "crm",
    category: "Insights",
    keywords: ["insight", "AI", "recommendation", "analysis", "CRM"],
    steps: [
      { text: "Click **Insights** in the CRM sidebar", target: "crm-sidebar-insights" },
      { text: "View AI-generated insights for your contacts and deals" },
      { text: "Click on an insight to see the full analysis and recommended actions" },
      { text: "Use insights to prioritize follow-ups and identify opportunities" },
    ],
    screenshot: {
      path: "/crm/insights",
      file: "crm-insights.png",
      alt: "CRM Insights page showing the empty documents list with the + New Document button (no insight documents yet)",
    },
  },

  // ── Court Designer ─────────────────────────────────────
  {
    slug: "crm-court-designer",
    title: "How to use Court Designer from CRM",
    summary: "Design court layouts linked to CRM contacts for personalized proposals.",
    section: "crm",
    category: "Court Designer",
    keywords: ["court", "designer", "CRM", "layout", "proposal"],
    steps: [
      { text: "Click **Court Designer** in the CRM sidebar", target: "crm-sidebar-court-images" },
      { text: "Select the sport and customize the court dimensions" },
      { text: "Choose surface type and colors for the layout" },
      { text: "Link the design to a contact or deal for proposals" },
      { text: "Export as image or add to a quotation PDF" },
    ],
    screenshot: {
      path: "/crm/court-images",
      file: "crm-court-designer.png",
      alt: "Court Designer page listing saved court designs with the + New design button (customer names and phones blurred)",
      blur: BLUR_COURT_CARDS,
    },
  },

  // ── Analytics ──────────────────────────────────────────
  {
    slug: "crm-analytics",
    title: "How to view CRM analytics",
    summary: "Track team and individual sales performance, best sellers, and platform metrics.",
    section: "crm",
    category: "Analytics",
    keywords: ["analytics", "performance", "sales", "team", "rep", "metrics"],
    steps: [
      { text: "Open **CRM Analytics** from the CRM All Tools menu", target: "crm-sidebar-all-tools" },
      { text: "View the team-wide dashboard with deals won, revenue, and conversion rates", target: "crm-analytics-per-rep" },
      { text: "Click a **team member** in the **Individual performance** tab to see their individual performance", target: "crm-analytics-rep-link" },
      { text: "Switch between the **Overview**, **Overall performance**, **Individual performance**, **Geography**, **Best-selling products**, and **Platform performance** tabs for different views", target: "crm-analytics-tabs" },
      { text: "Use the date range picker to compare different periods", target: "crm-analytics-date-range" },
    ],
    screenshot: {
      path: "/crm/analytics",
      file: "crm-analytics.png",
      alt: "CRM analytics dashboard with team performance",
      setup: [HYDRATE, { type: "click", selector: "button::-p-text(Individual performance)" }, { type: "wait", duration: 2000 }],
      blur: ['[data-guide="crm-analytics-per-rep"] tbody td:first-child'], // Rep names
    },
  },

  // ── Admin ──────────────────────────────────────────────
  {
    slug: "crm-taxonomies",
    title: "How to manage taxonomies",
    summary: "Edit funnel stages, lead sources, customer profiles, and other configurable lists.",
    section: "crm",
    category: "Admin",
    roles: ["admin"],
    keywords: ["taxonomy", "stage", "source", "profile", "configure", "list"],
    steps: [
      { text: "Open **Taxonomies** from the CRM Admin tools" },
      { text: "Select the list to edit: Funnel Stages, Lead Sources, or Customer Profiles", target: "crm-taxonomy-tabs" },
      { text: "Type a name in the **Add new…** box at the bottom of the list and click **Add**", target: "crm-taxonomy-add" },
      { text: "Use the **↑** and **↓** arrows in the **Order** column to reorder items (this changes the order in dropdowns)", target: "crm-taxonomy-order" },
      { text: "Click a name to rename it, or untick **Active** to retire an item you no longer need", target: "crm-taxonomy-active" },
    ],
    screenshot: {
      path: "/crm/admin/taxonomies",
      file: "crm-taxonomies.png",
      alt: "Taxonomies page with editable funnel stages",
      viewport: { width: 1440, height: 1500 },
    },
  },
  {
    slug: "crm-targets",
    title: "How to set revenue targets",
    summary: "Set company-wide or per-rep revenue targets by month, quarter, or financial year.",
    section: "crm",
    category: "Admin",
    roles: ["admin"],
    keywords: ["target", "revenue", "goal", "monthly", "quarterly", "rep"],
    steps: [
      { text: "Open **Targets** from the CRM Admin tools" },
      { text: "Choose the **Period**: **Month**, **Quarter**, or **Fiscal year**", target: "crm-targets-period" },
      { text: "Enter the **Target revenue (₹)** — keep **Scope** on **Company-wide** for a company-wide target", target: "crm-targets-revenue" },
      { text: "Optionally break it down by rep: pick a name in the **Scope** dropdown and save a separate target for each", target: "crm-targets-scope" },
      { text: "Click **Save target** — progress is tracked on **CRM Analytics → Overview**", target: "crm-targets-save" },
    ],
    screenshot: {
      path: "/crm/admin/targets",
      file: "crm-targets.png",
      alt: "Revenue targets page with monthly and per-rep settings",
    },
  },

  // ── Filter Guides ──────────────────────────────────────
  {
    slug: "filter-crm-contacts",
    title: "How to filter CRM contacts",
    summary: "Search by name, filter by date range, rep owner, and custom fields to find specific contacts.",
    section: "crm",
    category: "Contacts",
    keywords: ["filter", "contacts", "search", "date", "rep", "owner", "field", "CRM"],
    steps: [
      { text: "Go to **Contacts** in the CRM sidebar", target: "crm-sidebar-contacts" },
      { text: "Type in the **search bar** to find contacts by name or company", target: "crm-contacts-search" },
      { text: "Use the **date range picker** (From / To) to filter by when contacts were added", target: "crm-contacts-date" },
      { text: "Admin: use the **Rep dropdown** (\"All reps\") to filter by contact owner", target: "crm-contacts-rep" },
      { text: "Use the **Filter by custom field** dropdown to filter by Location, City, or other fields" },
      { text: "Select a **condition** (contains, equals, is set) and enter a value" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-filter-contacts.png",
      alt: "CRM contacts page with the search bar, date range picker and rep filter (the custom field filter only appears once contacts have custom fields)",
      blur: BLUR_CONTACT_TABLE,
    },
  },
  {
    slug: "filter-pipeline",
    title: "How to filter the pipeline board",
    summary: "Search deals, filter by owner, and switch between Kanban and Funnel views.",
    section: "crm",
    category: "Pipeline",
    keywords: ["filter", "pipeline", "search", "owner", "kanban", "funnel", "view"],
    steps: [
      { text: "Click **Pipeline** in the CRM sidebar", target: "crm-sidebar-pipeline" },
      { text: "Type in the **search bar** to find deals by name, phone, or message", target: "crm-pipeline-search" },
      { text: "Use the **Owner dropdown** to see only your deals, unassigned deals, or a specific rep's deals", target: "crm-pipeline-owner" },
      { text: "Switch between **Kanban** (card columns) and **Funnel** (stage chart) views", target: "crm-pipeline-view" },
    ],
    screenshot: {
      path: "/pipeline",
      file: "crm-filter-pipeline.png",
      alt: "Pipeline board with search, owner filter, and Kanban/Funnel view toggle",
      blur: BLUR_PIPELINE_CARDS,
    },
  },
  {
    slug: "filter-activities",
    title: "How to filter activities",
    summary: "Search activities, filter by date range, type (Calls, Meetings, Other), and show today only.",
    section: "crm",
    category: "Activities",
    keywords: ["filter", "activities", "search", "date", "type", "call", "meeting", "today"],
    steps: [
      { text: "Click **Activities** in the CRM sidebar", target: "crm-sidebar-activities" },
      { text: "Type in the **search bar** to find activities by subject, customer, phone, or deal code", target: "crm-activities-search" },
      { text: "Use the **date range picker** (From / To) to narrow to a specific period", target: "crm-activities-date" },
      { text: "Click **Calls**, **Meetings**, or **Other** in the left panel to filter by activity type", target: "crm-activities-type" },
      { text: "Click **Today** to show only today's activities", target: "crm-activities-today" },
      { text: "Each type shows a count badge so you know how many activities exist", target: "crm-activities-count" },
    ],
    screenshot: {
      path: "/crm/activities",
      file: "crm-filter-activities.png",
      alt: "Activities page with search, date range, and type filter sidebar (customer names and phones blurred)",
      blur: BLUR_ACTIVITIES_TABLE,
    },
  },
  {
    slug: "filter-crm-analytics",
    title: "How to filter CRM analytics",
    summary: "Use date ranges, period pickers, and analysis groups to drill into team and individual performance.",
    section: "crm",
    category: "Analytics",
    keywords: ["filter", "analytics", "date", "period", "month", "quarter", "group", "tab"],
    steps: [
      { text: "Open **CRM Analytics** from the CRM All Tools menu", target: "crm-sidebar-all-tools" },
      { text: "Use the **date range picker** to set a custom from/to period", target: "crm-analytics-date-range" },
      { text: "Switch between analysis groups: **Performance**, **Comparisons & Patterns**, **Quadrants & Territory**, **Industry Insights**, **Insights & Digest**", target: "crm-analytics-groups" },
      { text: "Each group has sub-tabs for deeper analysis (e.g., Overview, Individual performance, Geography)", target: "crm-analytics-tabs" },
      { text: "In the Overview tab, use the **Period picker** to compare by Month, Quarter, or Fiscal year", target: "crm-analytics-period" },
    ],
    screenshot: {
      path: "/crm/analytics",
      file: "crm-filter-analytics.png",
      alt: "CRM analytics page with date range, group tabs, and period picker",
      blur: ['[data-guide="crm-analytics-rankings"] tbody td:first-child'], // Rep names
    },
  },
  {
    slug: "filter-crm-leads",
    title: "How to filter CRM leads",
    summary: "Search leads by name or company to quickly find specific entries in the leads list.",
    section: "crm",
    category: "Leads",
    keywords: ["filter", "leads", "search", "CRM", "name", "company"],
    steps: [
      { text: "Click **Leads** in the CRM sidebar", target: "crm-sidebar-leads" },
      { text: "Type in the **search bar** to find leads by name or company", target: "crm-leads-search" },
      { text: "Results update as you type — matching leads are shown immediately" },
    ],
    screenshot: {
      path: "/crm/leads",
      file: "crm-filter-leads.png",
      alt: "CRM leads page with search bar",
      blur: BLUR_LEADS_TABLE,
    },
  },

  // ── Additional Contacts Guides ────────────────────────
  {
    slug: "crm-contact-detail",
    title: "How to view and edit CRM contact details",
    summary: "Open a contact's full profile to see deals, activities, notes, and edit their information.",
    section: "crm",
    category: "Contacts",
    keywords: ["contact", "detail", "view", "edit", "profile", "deals", "activities"],
    steps: [
      { text: "Go to **Contacts** in the CRM sidebar", target: "crm-sidebar-contacts" },
      { text: "Click on a contact's name to open their detail page", target: "crm-contact-name" },
      { text: "View their company, designation, lead source, and contact info", target: "crm-contact-info" },
      { text: "Scroll to see linked **Deals**, **Activities**, and **Notes**", target: "crm-contact-deals" },
      { text: "Click **Edit** to update any field, or the **+** button in the **Deals** section to create a new deal", target: "crm-contact-edit" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-contact-detail.png",
      alt: "CRM contact detail page (personal details blurred) with the details card, Deals section and Edit button",
      // Opens the first contact by following its name link.
      setup: OPEN_FIRST_CONTACT,
      blur: BLUR_CONTACT_DETAIL,
      viewport: { width: 1440, height: 1200 },
    },
  },
  {
    slug: "crm-company-detail",
    title: "How to view company details",
    summary: "Open a customer segment or company to see all contacts, deals, and revenue linked to it.",
    section: "crm",
    category: "Contacts",
    keywords: ["company", "segment", "detail", "view", "contacts", "revenue"],
    steps: [
      { text: "Open **Customer Segments** from the CRM All Tools menu", target: "crm-sidebar-all-tools" },
      { text: "Click on a company or segment name to open its detail page", target: "crm-company-name" },
      { text: "View all contacts associated with this company", target: "crm-company-contacts" },
      { text: "Check the total deal value and revenue generated", target: "crm-company-deals" },
      { text: "Click a contact to jump to their individual detail page", target: "crm-company-contact-link" },
    ],
    screenshot: {
      path: "/crm/companies",
      file: "crm-company-detail.png",
      alt: "Company detail page (personal details blurred) with the Contacts and Deals sections",
      // Opens the first company that has at least one deal (Deals column not 0) by following its name link.
      setup: [
        HYDRATE,
        { type: "click", selector: '::-p-xpath(//table[contains(@class,"data-table")]//tbody/tr[normalize-space(td[6])!="0"]//a)' },
        { type: "wait", duration: 4000 },
      ],
      blur: BLUR_COMPANY_DETAIL,
      viewport: { width: 1440, height: 1100 },
    },
  },

  // ── Additional Deals Guides ───────────────────────────
  {
    slug: "crm-deal-detail",
    title: "How to view deal details",
    summary: "Open a deal to see its value, stage history, linked contact, notes, and activity log.",
    section: "crm",
    category: "Deals",
    keywords: ["deal", "detail", "view", "stage", "history", "notes", "value"],
    steps: [
      { text: "Click **Deals** in the CRM sidebar or open a deal from the Pipeline board", target: "crm-sidebar-deals" },
      { text: "Click on a deal row to open its detail page", target: "crm-deal-title" },
      { text: "View the deal value, current stage, expected close date, and owner", target: "crm-deal-summary" },
      { text: "Check the **Timeline** for all calls, meetings, and notes linked to this deal", target: "crm-deal-activity" },
      { text: "Update the stage by clicking the **stage badge** and selecting a new stage" },
    ],
    screenshot: {
      path: "/deals",
      file: "crm-deal-detail.png",
      alt: "Deal detail page (personal details blurred) with the summary card and the Timeline",
      // Opens the first deal in the list by following its title link.
      setup: [HYDRATE, { type: "click", selector: '.data-table tbody a[href^="/deals/"]' }, { type: "wait", duration: 4000 }],
      blur: BLUR_DEAL_DETAIL,
      viewport: { width: 1440, height: 1100 },
    },
  },

  // ── Additional Analytics Guides ───────────────────────
  {
    slug: "crm-rep-analytics",
    title: "How to view individual rep performance",
    summary: "Drill into a specific sales rep's deals won, revenue, activities, and conversion rates.",
    section: "crm",
    category: "Analytics",
    keywords: ["rep", "individual", "performance", "sales", "analytics", "deals", "revenue"],
    steps: [
      { text: "Open **CRM Analytics** from the CRM All Tools menu", target: "crm-sidebar-all-tools" },
      { text: "Click on a **team member's name** in the **Individual performance** tab to open their individual report", target: "crm-rep-header" },
      { text: "View their deals won, revenue generated, and conversion rate" },
      { text: "Check their activity count (calls, meetings, emails)" },
      { text: "Compare their performance against team targets" },
    ],
    screenshot: {
      path: "/crm/analytics",
      file: "crm-rep-analytics.png",
      alt: "Individual rep analytics page with deals and revenue metrics",
      setup: [
        HYDRATE,
        { type: "click", selector: "button::-p-text(Individual performance)" },
        { type: "click", selector: 'a[href^="/crm/analytics/rep/"]' },
        { type: "wait", duration: 4000 },
      ],
      blur: [
        // Rep name: large heading text stays guessable at 7px, so this entry carries its own stronger blur (the trailing selector is a dummy that absorbs the script's suffix).
        '[data-guide="crm-rep-header"] h1{filter:blur(18px)!important}.guide-blur-dummy',
        ".data-table tbody td:nth-child(1)", // Customer name + deal code
        ".data-table tbody td:nth-child(4)", // Latest note / next activity text
      ],
    },
  },
  {
    slug: "crm-deal-analytics",
    title: "How to view deal analytics",
    summary: "Analyze deal flow, win rates, average deal size, and pipeline health.",
    section: "crm",
    category: "Analytics",
    keywords: ["deal", "analytics", "win rate", "pipeline", "health", "flow", "size"],
    steps: [
      { text: "Open **CRM Analytics** from the CRM All Tools menu", target: "crm-sidebar-all-tools" },
      { text: "Switch to the **Overall performance** tab to see deal-specific analytics", target: "crm-analytics-tab-overall" },
      { text: "View win rates, average deal size, and total pipeline value" },
      { text: "Check the deal flow funnel to see how deals progress through stages", target: "crm-analytics-pipeline-stage" },
      { text: "Use date range filters to compare different periods", target: "crm-analytics-date-range" },
    ],
    screenshot: {
      path: "/crm/analytics",
      file: "crm-deal-analytics.png",
      alt: "Deal analytics page with win rates and pipeline funnel",
      setup: [HYDRATE, { type: "click", selector: "button::-p-text(Overall performance)" }, { type: "wait", duration: 2000 }],
      blur: [
        '[data-guide="crm-analytics-by-rep"] tbody td:first-child', // Rep names (table)
        '[data-guide="crm-analytics-by-rep"] .recharts-wrapper', // Rep names (chart labels are SVG text, so blur the whole chart)
      ],
      viewport: { width: 1440, height: 1400 },
    },
  },

  // ── Additional Admin Guides ───────────────────────────
  {
    slug: "crm-settings",
    title: "How to manage CRM settings",
    summary: "Access taxonomies, user management, and audit log from the CRM settings hub.",
    section: "crm",
    category: "Admin",
    roles: ["admin"],
    keywords: ["settings", "admin", "configure", "CRM", "hub"],
    steps: [
      { text: "Open **CRM Settings** from the CRM All Tools menu (admin only)" },
      { text: "Navigate to **Taxonomies** to edit funnel stages, lead sources, and profiles", target: "crm-settings-taxonomies" },
      { text: "Use **Targets** to set revenue goals for the team", target: "crm-settings-targets" },
      { text: "Go to **Users** to manage team members and role assignments", target: "crm-settings-users" },
      { text: "Check the **Audit log** for a history of all changes", target: "crm-settings-audit-log" },
    ],
    screenshot: {
      path: "/crm/settings",
      file: "crm-settings.png",
      alt: "CRM settings hub with taxonomies, users, and audit links",
    },
  },
  {
    slug: "crm-audit-log",
    title: "How to view the CRM audit log",
    summary: "Review a chronological record of all stage changes, role changes, and taxonomy edits in CRM.",
    section: "crm",
    category: "Admin",
    roles: ["admin"],
    keywords: ["audit", "log", "history", "changes", "track", "CRM"],
    steps: [
      { text: "Open **Audit log** from the CRM Admin section in All Tools" },
      { text: "View a chronological list of all changes made in the CRM", target: "crm-audit-columns" },
      { text: "Each entry shows who made the change, what changed, and when", target: "crm-audit-row" },
      { text: "Use the **All entities** filter to show changes to one type of record only, such as deals or users", target: "crm-audit-filter" },
      { text: "Use the audit log to track stage changes, role updates, and taxonomy edits" },
    ],
    screenshot: {
      path: "/crm/admin/audit-log",
      file: "crm-audit-log.png",
      alt: "CRM audit log showing change history",
    },
  },
  {
    slug: "crm-ai-usage",
    title: "How to track AI usage in CRM",
    summary: "Monitor who is using AI features, request counts, and estimated spend in the CRM.",
    section: "crm",
    category: "Admin",
    roles: ["admin"],
    keywords: ["AI", "usage", "cost", "requests", "spend", "monitor", "CRM"],
    steps: [
      { text: "Open **AI usage** from the CRM Admin section in All Tools" },
      { text: "View **Total requests**, **This month**, and **Est. total spend** in the cards at the top", target: "crm-ai-chart" },
      { text: "See **Requests by person**, ranked most to least, to identify who uses AI the most", target: "crm-ai-by-person" },
      { text: "Monitor usage trends over time to manage costs" },
      { text: "Use this data to set usage guidelines for your team" },
    ],
    screenshot: {
      path: "/crm/admin/ai-usage",
      file: "crm-ai-usage.png",
      alt: "CRM AI usage page with request counts and spend",
    },
  },
];

export const CRM_RECORDING: SectionRecording = {
  slug: "crm-overview",
  title: "CRM Overview",
  section: "crm",
  startUrl: "/crm",
  actions: [
    { type: "caption", text: "CRM — track your entire sales process from first contact to closed deal", duration: 3000 },

    { type: "caption", text: "The Dashboard shows team performance — quotations sent, deal values, and top movers this month" },
    { type: "wait", duration: 2500 },

    { type: "caption", text: "Contacts — your complete customer database with companies, phone, email, and deal history" },
    { type: "highlight", selector: "[data-guide='crm-sidebar-contacts']", label: "Contacts" },
    { type: "click", selector: "[data-guide='crm-sidebar-contacts']" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "Add new contacts manually or import them — each contact links to their WhatsApp conversation" },
    { type: "highlight", selector: "[data-guide='crm-contact-create']", label: "New Contact" },

    { type: "caption", text: "Leads — incoming prospects from WhatsApp chatbot, ad campaigns, and manual entry" },
    { type: "click", selector: "[data-guide='crm-sidebar-leads']" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "Qualify leads, assign them to sales reps, and convert them into deals when ready" },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "Deals — track revenue with amounts, stages, expected close dates, and win probability" },
    { type: "click", selector: "[data-guide='crm-sidebar-deals']" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "Each deal links to a contact and company — attach quotations and log all activities" },
    { type: "wait", duration: 1500 },

    { type: "caption", text: "Pipeline — drag-and-drop Kanban board showing deals across custom stages" },
    { type: "click", selector: "[data-guide='crm-sidebar-pipeline']" },
    { type: "wait", duration: 2500 },
    { type: "caption", text: "Move deals between stages by dragging — the pipeline updates totals automatically" },
    { type: "scroll", direction: "down", amount: 300 },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "Also available: Activities, Reminders, Quotations, Analytics, and Admin settings — see guides below", duration: 3000 },
  ],
};
