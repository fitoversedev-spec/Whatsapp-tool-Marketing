import type { GuideEntry, SectionRecording } from "../types";

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
      { text: "Review the KPI cards at the top (contacts, deals, revenue)" },
      { text: "Check the **Recent Activity** section for latest updates" },
      { text: "Use the **quick action buttons** to jump to common tasks" },
    ],
    screenshot: {
      path: "/crm",
      file: "crm-dashboard.png",
      alt: "CRM Dashboard with KPI cards and recent activity",
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
      { text: "Go to **Contacts** in the CRM sidebar", target: "crm-sidebar-contacts" },
      { text: "Click the **+ New Contact** button at the top-right", target: "crm-contact-create" },
      { text: "Fill in name, phone, email, company, designation, and lead source" },
      { text: "Click **Save** — the contact appears in the table immediately" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-add-contact.png",
      alt: "CRM contacts page with New Contact button highlighted",
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
      { text: "Go to **Contacts** in the CRM sidebar" },
      { text: "Tick the **checkboxes** next to each contact you want to reassign" },
      { text: "The teal action bar appears — find the **Reassign owner to...** dropdown", target: "crm-bulk-reassign" },
      { text: "Pick the target rep and click **Apply**" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-bulk-assign.png",
      alt: "CRM contacts page with bulk action bar showing reassign dropdown",
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
      { text: "Open **Import** from the CRM All Tools menu" },
      { text: "Select what you're importing: Contacts, Companies, Leads, or Deals" },
      { text: "Upload your CSV or Excel file" },
      { text: "Map each column to the matching field (name, phone, email, etc.)" },
      { text: "Review the preview and click **Import** to load the data" },
    ],
    screenshot: {
      path: "/crm/import",
      file: "crm-import.png",
      alt: "Import page with file upload and column mapping",
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
      { text: "Open **Customer Segments** from the CRM All Tools menu" },
      { text: "Browse segments grouped by business type, lead source, or city" },
      { text: "Click a segment to see all contacts within it" },
      { text: "Use this view to identify your strongest market segments" },
    ],
    screenshot: {
      path: "/crm/companies",
      file: "crm-customer-segments.png",
      alt: "Customer segments page showing grouped contacts",
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
      { text: "Click a lead to open their detail and update the stage" },
      { text: "Move a qualified lead to **Converted** to create a contact + deal" },
    ],
    screenshot: {
      path: "/crm/leads",
      file: "crm-leads.png",
      alt: "CRM leads list with stage filters",
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
      { text: "Open a **contact's detail page** by clicking their name" },
      { text: "Scroll to the **Deals** section and click **+ Add Deal**", target: "crm-deal-add" },
      { text: "Enter deal name, value, expected close date, and funnel stage" },
      { text: "Click **Save** — the deal appears in both the contact view and the Pipeline board" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-create-deal.png",
      alt: "Contact detail page with Add Deal section highlighted",
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
      { text: "View all deals with their stage, value, owner, and close date" },
      { text: "Use **filters** to narrow by stage, owner, or date range" },
      { text: "Click a deal row to open its detail page with notes and activity log" },
      { text: "Update the deal stage by clicking the **stage badge** and selecting the new stage" },
    ],
    screenshot: {
      path: "/deals",
      file: "crm-deals-list.png",
      alt: "Deals list page with stage and value columns",
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
      { text: "View deals arranged in columns by stage (New → Qualified → Proposal → Won)" },
      { text: "**Drag a deal card** from one column to another to change its stage" },
      { text: "Click a deal card to open its detail page" },
      { text: "Use the **filter bar** to show only specific owners or date ranges" },
    ],
    screenshot: {
      path: "/pipeline",
      file: "crm-pipeline.png",
      alt: "Pipeline Kanban board with deals organized by stage",
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
      alt: "CRM reminders page with upcoming tasks",
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
      { text: "Click **+ New Quotation** and link it to a contact" },
      { text: "Select sport, area, surface type, and additional items" },
      { text: "Review the calculated total and click **Generate PDF**" },
      { text: "Send the quotation to the client via WhatsApp or download as PDF" },
    ],
    screenshot: {
      path: "/crm/quotations",
      file: "crm-quotations.png",
      alt: "CRM quotations page with rate calculator",
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
      { text: "Open **Invoices** from the CRM All Tools menu" },
      { text: "View all invoices with amount, status, and linked contact" },
      { text: "Click **+ New Invoice** or convert an existing quotation" },
      { text: "Update payment status as payments come in (Pending → Partial → Paid)" },
      { text: "Click **Download PDF** to save or print" },
    ],
    screenshot: {
      path: "/crm/invoices",
      file: "crm-invoices.png",
      alt: "CRM invoices page with payment status tracking",
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
      alt: "Activities page with logged calls and meetings",
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
      alt: "CRM Insights page with AI recommendations",
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
      alt: "Court Designer in CRM context",
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
      { text: "Open **CRM Analytics** from the CRM All Tools menu" },
      { text: "View the team-wide dashboard with deals won, revenue, and conversion rates" },
      { text: "Click a **team member** to see their individual performance" },
      { text: "Switch between **Deals**, **Activities**, and **Revenue** tabs for different views" },
      { text: "Use the date range picker to compare different periods" },
    ],
    screenshot: {
      path: "/crm/analytics",
      file: "crm-analytics.png",
      alt: "CRM analytics dashboard with team performance",
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
      { text: "Select the list to edit: Funnel Stages, Lead Sources, or Customer Profiles" },
      { text: "Click **+ Add** to create a new item in the list" },
      { text: "Drag items to reorder them (this changes the order in dropdowns)" },
      { text: "Click the **edit icon** to rename or the **delete icon** to remove" },
    ],
    screenshot: {
      path: "/crm/admin/taxonomies",
      file: "crm-taxonomies.png",
      alt: "Taxonomies page with editable funnel stages",
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
      { text: "Select the time period: Monthly, Quarterly, or FY" },
      { text: "Set the **company-wide target** amount" },
      { text: "Optionally break it down by **individual rep** targets" },
      { text: "Click **Save** — progress is tracked on the CRM Dashboard" },
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
      { text: "Use the **date range picker** (From / To) to filter by when contacts were added" },
      { text: "Admin: use the **Rep dropdown** (\"All reps\") to filter by contact owner", target: "crm-contacts-rep" },
      { text: "Use the **Filter by custom field** dropdown to filter by Location, City, or other fields" },
      { text: "Select a **condition** (contains, equals, is set) and enter a value" },
    ],
    screenshot: {
      path: "/crm/contacts",
      file: "crm-filter-contacts.png",
      alt: "CRM contacts page with search, date range, rep filter, and custom field filter",
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
      { text: "Use the **date range picker** (From / To) to narrow to a specific period" },
      { text: "Click **Calls**, **Meetings**, or **Other** in the left panel to filter by activity type", target: "crm-activities-type" },
      { text: "Click **Today** to show only today's activities" },
      { text: "Each type shows a count badge so you know how many activities exist" },
    ],
    screenshot: {
      path: "/crm/activities",
      file: "crm-filter-activities.png",
      alt: "Activities page with search, date range, and type filter sidebar",
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
      { text: "Open **CRM Analytics** from the CRM All Tools menu" },
      { text: "Use the **date range picker** to set a custom from/to period" },
      { text: "Switch between analysis groups: **Performance**, **Comparisons**, **Quadrants**, **Industry**, **Insights**", target: "crm-analytics-groups" },
      { text: "Each group has sub-tabs for deeper analysis (e.g., Overview, Individual, Geography)" },
      { text: "In the Overview tab, use the **Period picker** to compare by Month, Quarter, or Fiscal Year" },
    ],
    screenshot: {
      path: "/crm/analytics",
      file: "crm-filter-analytics.png",
      alt: "CRM analytics page with date range, group tabs, and period picker",
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
    },
  },
];

export const CRM_RECORDING: SectionRecording = {
  slug: "crm-overview",
  title: "CRM Overview",
  section: "crm",
  startUrl: "/crm",
  actions: [
    { type: "wait", duration: 2000 },
    { type: "highlight", selector: "[data-guide='crm-sidebar-contacts']", label: "Contacts" },
    { type: "click", selector: "[data-guide='crm-sidebar-contacts']" },
    { type: "wait", duration: 1500 },
    { type: "highlight", selector: "[data-guide='crm-contact-create']", label: "New Contact" },
    { type: "click", selector: "[data-guide='crm-sidebar-leads']" },
    { type: "wait", duration: 1500 },
    { type: "click", selector: "[data-guide='crm-sidebar-deals']" },
    { type: "wait", duration: 1500 },
    { type: "click", selector: "[data-guide='crm-sidebar-pipeline']" },
    { type: "wait", duration: 2000 },
    { type: "scroll", direction: "down", amount: 300 },
    { type: "wait", duration: 1000 },
  ],
};
