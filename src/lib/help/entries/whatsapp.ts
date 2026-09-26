import type { GuideEntry, ScreenshotSetupAction, SectionRecording } from "../types";

// A click on server-rendered markup that has not hydrated yet does nothing (happens right after the dev
// server recompiles a page), so every setup that clicks starts with a short wait.
const HYDRATE: ScreenshotSetupAction = { type: "wait", duration: 3000 };

// Opens the first Inbox conversation that has NO unread badge. Opening an unread one resets its
// counter in the database, so the unread-flagged rows must never be clicked by a capture run.
const OPEN_READ_CONVERSATION: ScreenshotSetupAction[] = [
  HYDRATE,
  { type: "click", selector: '[data-guide="wa-inbox-conversation"][data-unread="false"]' },
  { type: "wait", duration: 1500 },
];

// Chat messages and media are real customer content, so every capture that opens a conversation blurs them.
const BLUR_INBOX_MESSAGES = ['[data-guide="wa-inbox-messages"]'];

export const WHATSAPP_ENTRIES: GuideEntry[] = [
  // ── Inbox ──────────────────────────────────────────────
  {
    slug: "inbox-basics",
    title: "How to use the Inbox",
    summary: "Read and reply to WhatsApp conversations, send media, and assign chats to team members.",
    section: "whatsapp",
    category: "Inbox",
    keywords: ["inbox", "chat", "conversation", "reply", "message", "assign"],
    steps: [
      { text: "Click **Inbox** in the sidebar", target: "wa-sidebar-inbox" },
      { text: "Select a conversation from the left panel to open it", target: "wa-inbox-conversation-open" },
      { text: "Type your reply in the message box at the bottom and hit **Send**", target: "wa-inbox-composer" },
      { text: "Use the **attachment icon** to send images, videos, or documents", target: "wa-inbox-attach" },
      { text: "Click **Reassign** at the top of the chat to assign it to a team member (admins only)", target: "wa-inbox-reassign" },
    ],
    screenshot: {
      path: "/inbox",
      file: "wa-inbox-basics.png",
      alt: "Inbox with an open conversation, the message composer and the Reassign button",
      setup: OPEN_READ_CONVERSATION,
      blur: BLUR_INBOX_MESSAGES,
    },
  },
  {
    slug: "quick-replies",
    title: "How to use quick replies",
    summary: "Save and reuse message snippets in the Inbox to reply faster.",
    section: "whatsapp",
    category: "Inbox",
    keywords: ["quick reply", "snippet", "canned", "template", "inbox"],
    steps: [
      { text: "Open a conversation in the **Inbox**", target: "wa-sidebar-inbox" },
      { text: "Click the **/ (slash)** icon in the message composer" },
      { text: "Pick a saved reply from the list, or type to search" },
      { text: "Edit the message if needed, then hit **Send**", target: "wa-inbox-composer" },
    ],
    screenshot: {
      path: "/inbox",
      file: "wa-quick-replies.png",
      alt: "Inbox conversation with the message composer and Send button",
      setup: OPEN_READ_CONVERSATION,
      blur: BLUR_INBOX_MESSAGES,
    },
  },

  // ── Contacts ───────────────────────────────────────────
  {
    slug: "manage-contacts",
    title: "How to add and manage contacts",
    summary: "Add new WhatsApp contacts, edit details, apply tags, and export your contact list.",
    section: "whatsapp",
    category: "Contacts",
    keywords: ["contact", "add", "create", "edit", "export", "manage"],
    steps: [
      { text: "Click **Contacts** in the sidebar", target: "wa-sidebar-contacts" },
      { text: "Click **+ Add** at the top-right to create a new contact", target: "wa-contacts-add" },
      { text: "Fill in the phone number (with country code), name, and any custom fields" },
      { text: "Click **Edit** on a contact row to view and update their details", target: "wa-contacts-edit" },
      { text: "Tick contacts with the checkboxes, then click **Export CSV** in the bar that appears to download them as a CSV", target: "wa-contacts-export" },
    ],
    screenshot: {
      path: "/contacts",
      file: "wa-manage-contacts.png",
      alt: "Contacts page with the Add button, a row's Edit link, and the Export CSV bar shown after ticking a contact",
      // Ticking a row checkbox only reveals the bulk-action bar (no request is made).
      setup: [
        HYDRATE,
        { type: "click", selector: 'table.data-table tbody input[type="checkbox"]' },
        { type: "wait", duration: 600 },
      ],
    },
  },
  {
    slug: "filter-contacts-tag",
    title: "How to filter contacts by tag",
    summary: "Use tags to segment your WhatsApp contacts list for targeted broadcasts.",
    section: "whatsapp",
    category: "Contacts",
    keywords: ["contacts", "filter", "tag", "segment"],
    steps: [
      { text: "Go to **Contacts** in the sidebar", target: "wa-sidebar-contacts" },
      { text: "Click the **Tags** filter dropdown above the table", target: "wa-contacts-tags" },
      { text: "Select a tag — the list updates instantly" },
      { text: "Use the filtered list to start a broadcast or export contacts" },
    ],
    screenshot: {
      path: "/contacts",
      file: "wa-filter-contacts.png",
      alt: "Contacts page with tag filter applied",
    },
  },
  {
    slug: "tags",
    title: "How to manage tags",
    summary: "Create, edit, and color-code tags to organize your contacts into meaningful groups.",
    section: "whatsapp",
    category: "Contacts",
    keywords: ["tags", "label", "color", "organize", "group", "category"],
    steps: [
      { text: "Open **Tags** from the All Tools menu in the sidebar", target: "wa-sidebar-all-tools" },
      { text: "Click **+ New tag** to create a new tag", target: "wa-tags-new" },
      { text: "Enter a tag name and pick a color", target: "wa-tags-name" },
      { text: "Click **Create** — the tag is now available when tagging contacts", target: "wa-tags-create" },
      { text: "Click **Edit** on any tag to rename or change its color", target: "wa-tags-edit" },
    ],
    screenshot: {
      path: "/tags",
      file: "wa-tags.png",
      alt: "Tags management page with the New tag form open",
      // Opens the empty New tag form only — nothing is typed or created.
      setup: [
        HYDRATE,
        { type: "click", selector: '[data-guide="wa-tags-new"]' },
        { type: "wait", duration: 600 },
      ],
    },
  },

  // ── Broadcasts ─────────────────────────────────────────
  {
    slug: "send-broadcast",
    title: "How to send a broadcast",
    summary: "Create and send a WhatsApp broadcast to a filtered set of contacts using a pre-approved template.",
    section: "whatsapp",
    category: "Broadcasts",
    keywords: ["broadcast", "send", "template", "bulk", "message"],
    steps: [
      { text: "Click **Broadcasts** in the sidebar", target: "wa-sidebar-broadcasts" },
      { text: "Click the **New broadcast** button at the top-right", target: "wa-broadcast-create" },
      { text: "Select a **template** from the dropdown — only approved templates appear", target: "wa-broadcast-template" },
      { text: "Use **Filter by field** to pick which contacts receive the broadcast (e.g., Location equals Salem)", target: "wa-broadcast-filter-rules" },
      { text: "Click **Preview recipients →** to review who will receive it, then click **Launch**", target: "wa-broadcast-launch" },
    ],
    screenshot: {
      path: "/broadcasts",
      file: "wa-send-broadcast.png",
      alt: "New broadcast composer with template dropdown, recipient filters and the Launch button",
      // Only opens the composer — nothing is filled in, previewed or sent.
      setup: [
        HYDRATE,
        { type: "click", selector: '[data-guide="wa-broadcast-create"]' },
        { type: "wait", duration: 1500 },
      ],
      viewport: { width: 1440, height: 1000 },
    },
  },
  {
    slug: "broadcast-analytics",
    title: "How to view broadcast analytics",
    summary: "Track delivery rates, read rates, and trends for all your broadcasts.",
    section: "whatsapp",
    category: "Broadcasts",
    keywords: ["analytics", "broadcast", "delivery", "read", "performance", "stats"],
    steps: [
      { text: "Open **Broadcast Analytics** from the All Tools menu", target: "wa-sidebar-all-tools" },
      { text: "View the overall delivery and read rate across all broadcasts", target: "wa-analytics-kpis" },
      { text: "Click on a specific broadcast row to see per-message stats", target: "wa-analytics-table" },
      { text: "Use the date range filter to narrow the time window", target: "wa-analytics-range" },
    ],
    screenshot: {
      path: "/analytics",
      file: "wa-broadcast-analytics.png",
      alt: "Broadcast analytics dashboard with delivery stats (no broadcasts sent yet)",
      viewport: { width: 1440, height: 1100 },
    },
  },

  // ── Templates ──────────────────────────────────────────
  {
    slug: "templates",
    title: "How to create message templates",
    summary: "Create and submit WhatsApp message templates for Meta approval before using them in broadcasts.",
    section: "whatsapp",
    category: "Templates",
    keywords: ["template", "create", "message", "meta", "approval", "whatsapp"],
    steps: [
      { text: "Open **Templates** from the All Tools menu in the sidebar", target: "wa-sidebar-all-tools" },
      { text: "Click **+ New template** to start creating a template", target: "wa-templates-new" },
      { text: "Choose a category (Marketing, Utility, or Authentication)", target: "wa-templates-category" },
      { text: "Write the header, body text (with variables like {{1}}), and footer", target: "wa-templates-body" },
      { text: "Add buttons if needed (Quick Reply, Call to Action, or URL)" },
      { text: "Click **Save draft**, then **Submit for review** — after admin approval Meta reviews the template (usually within minutes)", target: "wa-templates-save" },
      { text: "Once approved, the template is available for broadcasts" },
    ],
    screenshot: {
      path: "/templates",
      file: "wa-templates.png",
      alt: "New template draft dialog with category, body and the Save draft button",
      // Only opens the empty draft dialog — nothing is typed, saved or sent to Meta.
      setup: [
        HYDRATE,
        { type: "click", selector: '[data-guide="wa-templates-new"]' },
        { type: "wait", duration: 1000 },
      ],
      viewport: { width: 1440, height: 1000 },
    },
  },

  // ── Reminders ──────────────────────────────────────────
  {
    slug: "reminders",
    title: "How to set a reminder",
    summary: "Schedule follow-up reminders for contacts so you never miss a callback or task.",
    section: "whatsapp",
    category: "Reminders",
    keywords: ["reminder", "follow-up", "schedule", "task", "notification"],
    steps: [
      { text: "Click **Reminders** in the sidebar", target: "wa-sidebar-reminders" },
      { text: "Click **+ New Reminder** at the top-right" },
      { text: "Select the contact, set a date/time, and add a note" },
      { text: "Click **Save** — you'll be notified when it's due" },
      { text: "Mark a reminder as **done** to clear it from the list" },
    ],
    screenshot: {
      path: "/reminders",
      file: "wa-reminders.png",
      alt: "Reminders page with the date filter (no reminders are due right now)",
    },
  },

  // ── Bot Leads ──────────────────────────────────────────
  {
    slug: "bot-leads",
    title: "How to manage bot leads",
    summary: "View and process leads captured automatically by the chatbot from incoming conversations.",
    section: "whatsapp",
    category: "Bot Leads",
    keywords: ["bot", "leads", "chatbot", "auto", "capture", "convert"],
    steps: [
      { text: "Click **Bot Leads** in the sidebar", target: "wa-sidebar-leads" },
      { text: "Review the list of leads captured by the chatbot", target: "wa-leads-row" },
      { text: "Click **Open chat →** on a lead to see their conversation (the submission details are shown in the row)", target: "wa-leads-open-chat" },
      { text: "Use the **status filter** to see new, contacted, or converted leads", target: "wa-leads-status" },
      { text: "Convert a lead to a contact by clicking **Add to Contacts**" },
    ],
    screenshot: {
      path: "/leads",
      file: "wa-bot-leads.png",
      alt: "Bot leads page with lead list and status filters",
    },
  },

  // ── Media ──────────────────────────────────────────────
  {
    slug: "media-library",
    title: "How to use the media library",
    summary: "Upload and manage images, videos, and documents for use in conversations and broadcasts.",
    section: "whatsapp",
    category: "Media",
    keywords: ["media", "upload", "image", "video", "document", "library", "file"],
    steps: [
      { text: "Open **Media Library** from the All Tools menu", target: "wa-sidebar-all-tools" },
      { text: "Click **+ Upload** to add images, videos, or documents", target: "wa-media-upload" },
      { text: "Drag and drop files or browse from your computer" },
      { text: "Click any file to preview it or copy the URL", target: "wa-media-file" },
      { text: "Media uploaded here is available when sending messages or creating broadcasts" },
    ],
    screenshot: {
      path: "/media",
      file: "wa-media-library.png",
      alt: "Media library showing uploaded images and files",
    },
  },

  // ── Quotations & Invoices ──────────────────────────────
  {
    slug: "quotations",
    title: "How to create a quotation",
    summary: "Generate a professional quotation with sport selection, area, rates, and PDF export.",
    section: "whatsapp",
    category: "Quotations",
    keywords: ["quotation", "quote", "price", "rate", "pdf", "send"],
    steps: [
      { text: "Open **Quotations** from the All Tools menu", target: "wa-sidebar-all-tools" },
      { text: "Click **+ New quotation** to start", target: "wa-quote-new" },
      { text: "Select the sport, area dimensions, surface type, and additional items", target: "wa-quote-sport" },
      { text: "The system calculates the total based on your saved rates" },
      { text: "Click **Generate Preview →** to preview and download the quotation" },
      { text: "Use **Send to customer** to share it directly with the client" },
    ],
    screenshot: {
      path: "/quotations",
      file: "wa-quotations.png",
      alt: "New quotation wizard, step 1, with the customer and sport selection",
      // Only opens the wizard's first step — nothing is typed, and no draft is generated or sent.
      // The wizard is up to 1400px wide, so a 1920px capture leaves the sidebar and the New quotation
      // button visible beside it for steps 1 and 2.
      setup: [
        HYDRATE,
        { type: "click", selector: '[data-guide="wa-quote-new"]' },
        { type: "wait", duration: 1500 },
      ],
      viewport: { width: 1920, height: 1000 },
    },
  },
  {
    slug: "invoices",
    title: "How to manage invoices",
    summary: "Convert quotations to invoices, track payment status, and download invoice PDFs.",
    section: "whatsapp",
    category: "Invoices",
    keywords: ["invoice", "payment", "billing", "pdf", "convert", "track"],
    steps: [
      { text: "Open **Invoices** from the All Tools menu", target: "wa-sidebar-all-tools" },
      { text: "Click **+ New Invoice** or convert an existing quotation to an invoice" },
      { text: "Review the line items, tax, and total amount" },
      { text: "Set the payment status (Pending, Partial, Paid)", target: "wa-invoices-status" },
      { text: "Click **Download PDF** to save or print the invoice" },
    ],
    screenshot: {
      path: "/invoices",
      file: "wa-invoices.png",
      alt: "Invoices page with search, payment status filters and the invoice table (no invoices yet)",
    },
  },

  // ── Court Designer ─────────────────────────────────────
  {
    slug: "court-designer",
    title: "How to use the Court Designer",
    summary: "Design 2D and 3D court layouts for any sport, customize surfaces, and export images.",
    section: "whatsapp",
    category: "Court Designer",
    keywords: ["court", "designer", "layout", "sport", "surface", "2D", "3D", "image"],
    steps: [
      { text: "Open **Court Designer** from the All Tools menu" },
      { text: "Select the **sport** (football, basketball, tennis, etc.)", target: "wa-court-sports" },
      { text: "Choose the **surface appearance** and customize dimensions", target: "wa-court-dims" },
      { text: "Switch between the **2D plan** and **3D image** tabs" },
      { text: "Click **Download** to save the design or **Send on WhatsApp** to share it" },
    ],
    screenshot: {
      path: "/court-images",
      file: "wa-court-designer.png",
      alt: "New court design, step 1, with the sport and surface appearance choices",
      // Opens the designer's first step (a form) — nothing is selected, saved or sent.
      setup: [
        HYDRATE,
        { type: "click", selector: '[data-guide="wa-court-new"]' },
        { type: "wait", duration: 3000 },
      ],
      viewport: { width: 1440, height: 1000 },
    },
  },

  // ── Ad Campaigns ───────────────────────────────────────
  {
    slug: "ad-campaigns",
    title: "How to view ad campaign performance",
    summary: "Monitor Meta ad campaigns, track leads, and review AI-generated performance summaries.",
    section: "whatsapp",
    category: "Ad Campaigns",
    roles: ["admin"],
    keywords: ["ad", "campaign", "meta", "facebook", "leads", "performance"],
    steps: [
      { text: "Open **Ad Campaigns** from the All Tools menu", target: "wa-sidebar-all-tools" },
      { text: "View the list of active and past campaigns with spend and lead counts", target: "wa-campaigns-head" },
      { text: "Click a campaign to drill into its metrics and individual leads", target: "wa-campaign-link" },
      { text: "Open **Lead Analytics** for city-wise demand, repeat submitters, and AI insights" },
    ],
    screenshot: {
      path: "/ad-campaigns",
      file: "wa-ad-campaigns.png",
      alt: "Ad campaigns page with campaign list and lead metrics",
      viewport: { width: 1440, height: 1300 },
    },
  },

  // ── Products & Portfolio ───────────────────────────────
  {
    slug: "products",
    title: "How to manage products",
    summary: "Maintain your catalog of floorings, materials, and equipment with TDS sheets per sport.",
    section: "whatsapp",
    category: "Products",
    keywords: ["product", "catalog", "flooring", "material", "equipment", "TDS"],
    steps: [
      { text: "Open **Products** from the All Tools menu", target: "wa-sidebar-all-tools" },
      { text: "Browse existing products by sport or category", target: "wa-products-sport" },
      { text: "Click **+ Add product** to add a new item", target: "wa-products-add" },
      { text: "Fill in name, description, pricing, and upload TDS documents" },
      { text: "Products appear in quotations and court designer selections" },
    ],
    screenshot: {
      path: "/products",
      file: "wa-products.png",
      alt: "Products catalog page with sport categories",
    },
  },
  {
    slug: "portfolio",
    title: "How to use the portfolio gallery",
    summary: "Showcase past builds, generate per-sport catalogue PDFs, and share with prospective clients.",
    section: "whatsapp",
    category: "Portfolio",
    keywords: ["portfolio", "gallery", "past", "builds", "catalogue", "pdf", "share"],
    steps: [
      { text: "Open **Portfolio** from the All Tools menu", target: "wa-sidebar-all-tools" },
      { text: "Browse completed projects by sport", target: "wa-portfolio-sport" },
      { text: "Click **+ Add project** to upload images and project details", target: "wa-portfolio-add" },
      { text: "Use **Generate Catalogue** to create a PDF for a specific sport" },
      { text: "Share the catalogue link directly via WhatsApp" },
    ],
    screenshot: {
      path: "/portfolio",
      file: "wa-portfolio.png",
      alt: "Portfolio gallery showing past project builds",
    },
  },

  // ── Admin ──────────────────────────────────────────────
  {
    slug: "connection-status",
    title: "How to check connection status",
    summary: "Verify your Meta API connection, token health, and reconnect if the session expires.",
    section: "whatsapp",
    category: "Admin",
    roles: ["admin"],
    keywords: ["connection", "meta", "api", "token", "status", "reconnect"],
    steps: [
      { text: "Open **Connection** from the All Tools menu (Admin section)", target: "wa-sidebar-all-tools" },
      { text: "Check the **status indicator** — green means connected, red means expired", target: "wa-connection-status" },
      { text: "If expired, click **Reconnect** to re-authenticate with Meta" },
      { text: "The page also shows your phone number ID and business account details", target: "wa-connection-phone" },
    ],
    screenshot: {
      path: "/connection",
      file: "wa-connection.png",
      alt: "Connection page showing Meta API status and token health",
    },
  },
  {
    slug: "users-management",
    title: "How to manage users",
    summary: "Add team members, approve new user requests, and assign admin or sales roles.",
    section: "whatsapp",
    category: "Admin",
    roles: ["admin"],
    keywords: ["users", "team", "member", "role", "admin", "sales", "approve"],
    steps: [
      { text: "Open **Users** from the All Tools menu (Admin section)", target: "wa-sidebar-all-tools" },
      { text: "View all team members with their roles and last-active dates", target: "wa-users-tab-all" },
      { text: "Check the **Pending** tab for new sign-up requests", target: "wa-users-tab-pending" },
      { text: "Click **Approve** or **Reject** for each pending user" },
      { text: "Change a user's role by clicking the role badge and selecting Admin or Sales" },
    ],
    screenshot: {
      path: "/users",
      file: "wa-users.png",
      alt: "Users page with the All, Pending, Approved, Rejected and Deleted tabs (no pending approvals)",
    },
  },
  {
    slug: "search",
    title: "How to use global search",
    summary: "Quickly find contacts, conversations, and broadcasts across the entire platform.",
    section: "whatsapp",
    category: "Search",
    keywords: ["search", "find", "global", "lookup"],
    steps: [
      { text: "Click **Search** in the sidebar", target: "wa-sidebar-search" },
      { text: "Type a name, phone number, or keyword in the search bar", target: "wa-search-input" },
      { text: "Results show matching messages, notes, contacts, and templates" },
      { text: "Click any result to jump directly to that item" },
    ],
    screenshot: {
      path: "/search",
      file: "wa-search.png",
      alt: "Global search page with the search box and the date filter",
    },
  },

  // ── Filter Guides ──────────────────────────────────────
  {
    slug: "filter-inbox",
    title: "How to filter inbox conversations",
    summary: "Search conversations by name or phone, and switch between Open, Closed, and All views.",
    section: "whatsapp",
    category: "Inbox",
    keywords: ["filter", "inbox", "search", "open", "closed", "status", "conversation"],
    steps: [
      { text: "Click **Inbox** in the sidebar", target: "wa-sidebar-inbox" },
      { text: "Use the **search bar** at the top to find conversations by name, phone, or message text", target: "wa-inbox-search" },
      { text: "Click the **Open** tab to see only active conversations (default)", target: "wa-inbox-tab-open" },
      { text: "Click **Closed** to see resolved conversations", target: "wa-inbox-tab-closed" },
      { text: "Click **All** to see every conversation regardless of status", target: "wa-inbox-tab-all" },
    ],
    screenshot: {
      path: "/inbox",
      file: "wa-filter-inbox.png",
      alt: "Inbox page with search bar and Open/Closed/All status tabs",
    },
  },
  {
    slug: "filter-contacts",
    title: "How to filter WhatsApp contacts",
    summary: "Search contacts, filter by tag, and filter by custom fields like location or city.",
    section: "whatsapp",
    category: "Contacts",
    keywords: ["filter", "contacts", "search", "tag", "field", "location", "city"],
    steps: [
      { text: "Go to **Contacts** in the sidebar", target: "wa-sidebar-contacts" },
      { text: "Type in the **search bar** to find contacts by name or phone number", target: "wa-contacts-search" },
      { text: "Use the **Tags dropdown** (\"All tags\") to filter by a specific tag", target: "wa-contacts-tags" },
      { text: "Use the **Filter by field** dropdown to filter by a custom field (e.g., Location, City)", target: "wa-contacts-field-filter" },
      { text: "Enter a value — the table updates instantly to show matching contacts", target: "wa-contacts-field-value" },
    ],
    screenshot: {
      path: "/contacts",
      file: "wa-filter-contacts-full.png",
      alt: "Contacts page with search, tag filter, field filter dropdowns and the value box",
      // Picks a field in the dropdown (keyboard type-ahead) so the value box appears; no value is entered.
      setup: [
        HYDRATE,
        { type: "type", selector: '[data-guide="wa-contacts-field-filter"]', text: "Attr" },
        { type: "wait", duration: 800 },
      ],
    },
  },
  {
    slug: "filter-broadcast-recipients",
    title: "How to filter broadcast recipients",
    summary: "Use field filters or pick specific contacts when creating a broadcast to target the right audience.",
    section: "whatsapp",
    category: "Broadcasts",
    keywords: ["filter", "broadcast", "recipients", "field", "pick", "contacts", "target"],
    steps: [
      { text: "Click **+ New broadcast** on the Broadcasts page", target: "wa-broadcast-create" },
      { text: "Under **Contact source**, choose \"Saved Contacts\"", target: "wa-broadcast-source" },
      { text: "Select **Filter by field** to add dynamic rules (e.g., Location equals \"Mumbai\")", target: "wa-broadcast-mode-filter" },
      { text: "Click **+ Add filter** to combine multiple conditions (e.g., Location + Name)", target: "wa-broadcast-add-filter" },
      { text: "Or select **Pick specific** to manually search and select individual contacts", target: "wa-broadcast-mode-pick" },
      { text: "Click **Preview recipients →** to see how many contacts match your filters", target: "wa-broadcast-preview" },
    ],
    screenshot: {
      path: "/broadcasts",
      file: "wa-filter-broadcast-recipients.png",
      alt: "Broadcast composer with the recipient filter builder and an empty filter rule",
      // Opens the composer and adds one blank filter row (local UI state only) — nothing is previewed or sent.
      setup: [
        HYDRATE,
        { type: "click", selector: '[data-guide="wa-broadcast-create"]' },
        { type: "wait", duration: 1500 },
        { type: "click", selector: '[data-guide="wa-broadcast-add-filter"]' },
        { type: "wait", duration: 600 },
      ],
      viewport: { width: 1440, height: 1100 },
    },
  },
  {
    slug: "filter-bot-leads",
    title: "How to filter bot leads",
    summary: "Filter leads by search, chatbot path, status, and assigned rep to manage them efficiently.",
    section: "whatsapp",
    category: "Bot Leads",
    keywords: ["filter", "bot", "leads", "path", "status", "assigned", "search"],
    steps: [
      { text: "Click **Bot Leads** in the sidebar", target: "wa-sidebar-leads" },
      { text: "Use the **search bar** to find leads by name, phone, or location", target: "wa-leads-search" },
      { text: "Use the **Path** dropdown to filter by chatbot path (Turnkey, Maintenance, Consultation, Product)", target: "wa-leads-path" },
      { text: "Use the **Status** dropdown to filter by stage (New, In progress, Contacted, Converted, Lost)", target: "wa-leads-status" },
      { text: "Use the **Assigned** dropdown to see leads assigned to a specific rep, or unassigned leads", target: "wa-leads-assigned" },
      { text: "Click **Clear** to reset all filters at once" },
    ],
    screenshot: {
      path: "/leads",
      file: "wa-filter-bot-leads.png",
      alt: "Bot leads page with search, path, status, and assigned filter dropdowns",
    },
  },
  {
    slug: "filter-templates-status",
    title: "How to filter templates by status",
    summary: "View templates by approval status — draft, pending, submitted, approved, or rejected.",
    section: "whatsapp",
    category: "Templates",
    keywords: ["filter", "template", "status", "draft", "approved", "rejected", "pending"],
    steps: [
      { text: "Open **Templates** from the All Tools menu" },
      { text: "Click a **status tab** to filter: All, Draft, Pending Admin, Submitted, Approved, or Rejected", target: "wa-templates-tabs" },
      { text: "Each tab shows the count of templates in that status" },
      { text: "Admin users can toggle **Show deleted** to see removed templates", target: "wa-templates-show-deleted" },
    ],
    screenshot: {
      path: "/templates",
      file: "wa-filter-templates.png",
      alt: "Templates page with status filter tabs",
    },
  },
  {
    slug: "filter-analytics-range",
    title: "How to filter analytics by date range",
    summary: "Switch between 7-day, 30-day, 90-day, and all-time views on the broadcast analytics page.",
    section: "whatsapp",
    category: "Broadcasts",
    keywords: ["filter", "analytics", "date", "range", "7 days", "30 days", "90 days"],
    steps: [
      { text: "Open **Broadcast Analytics** from the All Tools menu" },
      { text: "Click the **date range buttons** at the top: 7 days, 30 days, 90 days, or All time", target: "wa-analytics-range" },
      { text: "The charts and stats update to show only the selected period" },
      { text: "Use this to compare recent performance vs. longer-term trends" },
    ],
    screenshot: {
      path: "/analytics",
      file: "wa-filter-analytics.png",
      alt: "Analytics page with date range selector buttons",
    },
  },
  {
    slug: "filter-ad-leads",
    title: "How to filter ad campaign leads",
    summary: "Filter Meta ad leads by city, sport, area, stage, and assigned rep with searchable dropdowns.",
    section: "whatsapp",
    category: "Ad Campaigns",
    roles: ["admin"],
    keywords: ["filter", "ad", "leads", "city", "sport", "area", "stage", "assigned"],
    steps: [
      { text: "Open **Ad Campaigns** from the All Tools menu" },
      { text: "Scroll to the **Lead-gen leads** table", target: "wa-ad-leads-heading" },
      { text: "Use the **City** dropdown to filter leads from a specific city", target: "wa-ad-city" },
      { text: "Use the **Sport** dropdown to filter by sport interest", target: "wa-ad-sport" },
      { text: "Use the **Stage** dropdown to filter by lead stage (e.g., New, Contacted)", target: "wa-ad-stage" },
      { text: "Use the **Assigned To** dropdown to see leads assigned to a specific rep", target: "wa-ad-assigned" },
      { text: "Click **Clear** to reset all filters — filters are remembered during the session" },
    ],
    screenshot: {
      path: "/ad-campaigns",
      file: "wa-filter-ad-leads.png",
      alt: "Ad campaigns page with lead filter dropdowns for city, sport, area, stage",
    },
  },

  // ── Additional Inbox Guides ───────────────────────────
  {
    slug: "close-conversation",
    title: "How to close and reopen a conversation",
    summary: "Mark conversations as closed when resolved, and reopen them if the customer writes back.",
    section: "whatsapp",
    category: "Inbox",
    keywords: ["close", "reopen", "resolve", "conversation", "inbox", "archive"],
    steps: [
      { text: "Open a conversation in the **Inbox**", target: "wa-sidebar-inbox" },
      { text: "Click the **Close** button at the top of the chat", target: "wa-inbox-close" },
      { text: "The conversation moves to the **Closed** tab", target: "wa-inbox-tab-closed" },
      { text: "To reopen, switch to the **Closed** tab and click the conversation" },
      { text: "Click **Reopen** to move it back to Open" },
    ],
    screenshot: {
      path: "/inbox",
      file: "wa-close-conversation.png",
      alt: "Inbox conversation with the Close button and the Closed tab highlighted",
      setup: OPEN_READ_CONVERSATION,
      blur: BLUR_INBOX_MESSAGES,
    },
  },
  {
    slug: "create-quick-replies",
    title: "How to create and manage quick replies",
    summary: "Save message snippets as quick replies so your team can respond faster in the Inbox.",
    section: "whatsapp",
    category: "Inbox",
    keywords: ["quick reply", "create", "snippet", "manage", "canned", "save"],
    steps: [
      { text: "Open a conversation in the **Inbox**", target: "wa-sidebar-inbox" },
      { text: "Click the **/ (slash)** icon in the message composer" },
      { text: "Click **Manage quick replies** at the bottom of the list" },
      { text: "Click **+ New** to create a new quick reply" },
      { text: "Enter a **shortcut** (e.g., \"greeting\") and the **message text**" },
      { text: "Click **Save** — the quick reply is now available for all team members" },
    ],
    screenshot: {
      path: "/inbox",
      file: "wa-create-quick-replies.png",
      alt: "Inbox conversation with the message composer at the bottom",
      setup: OPEN_READ_CONVERSATION,
      blur: BLUR_INBOX_MESSAGES,
    },
  },

  // ── Additional Contacts Guides ────────────────────────
  {
    slug: "contact-detail",
    title: "How to view contact details",
    summary: "Open a contact's full profile to see their info, tags, conversation history, and deals.",
    section: "whatsapp",
    category: "Contacts",
    keywords: ["contact", "detail", "profile", "view", "info", "history"],
    steps: [
      { text: "Go to **Contacts** in the sidebar", target: "wa-sidebar-contacts" },
      { text: "Click on a contact's name in the table to open their detail page" },
      { text: "View their phone number, tags, custom fields, and notes", target: "wa-contact-info" },
      { text: "Scroll down to see their conversation history and any linked deals", target: "wa-contact-activity" },
      { text: "Click **Edit** to update their information or **+ Add tag…** to apply new tags", target: "wa-contact-tags" },
    ],
    screenshot: {
      // The contacts table has no clickable name; the detail page opens from Search → Contacts results.
      path: "/search?q=91",
      file: "wa-contact-detail.png",
      alt: "Contact detail page showing profile info, tags and activity history",
      setup: [{ type: "click", selector: 'a[href^="/contacts/"]' }],
      // Name/phone in the page header, the profile values and the activity feed are personal data.
      blur: ['[data-guide="wa-contact-feed"]', '[data-guide="wa-contact-value"]', "header h1", "header h1 + p"],
    },
  },
  {
    slug: "duplicate-contacts",
    title: "How to merge duplicate contacts",
    summary: "Find and merge contacts that share the same phone number to keep your list clean.",
    section: "whatsapp",
    category: "Contacts",
    roles: ["admin"],
    keywords: ["duplicate", "merge", "clean", "phone", "deduplicate"],
    steps: [
      { text: "Go to **Contacts** in the sidebar", target: "wa-sidebar-contacts" },
      { text: "Click **Find duplicates** at the top of the Contacts page to open the duplicates page" },
      { text: "Review groups of contacts that share the same phone number", target: "wa-duplicates-group" },
      { text: "Select which contact should be the **primary** (tags from all will be unified)" },
      { text: "Click **Merge** to combine the duplicates into one contact" },
    ],
    screenshot: {
      path: "/contacts/duplicates",
      file: "wa-duplicate-contacts.png",
      alt: "Duplicate contacts page (no duplicate groups detected in the current data)",
    },
  },

  // ── Additional Broadcast Guides ───────────────────────
  {
    slug: "broadcast-results",
    title: "How to view broadcast results",
    summary: "Check delivery status, read rates, and per-contact results for a sent broadcast.",
    section: "whatsapp",
    category: "Broadcasts",
    keywords: ["broadcast", "results", "detail", "delivery", "status", "read", "sent"],
    steps: [
      { text: "Click **Broadcasts** in the sidebar", target: "wa-sidebar-broadcasts" },
      { text: "Click on a completed broadcast row to open its detail page", target: "wa-broadcasts-list" },
      { text: "View the summary: total sent, delivered, read, and failed counts" },
      { text: "Scroll down to see **per-contact status** (delivered, read, or failed)" },
      { text: "Use this data to identify contacts with invalid numbers or delivery issues" },
    ],
    screenshot: {
      path: "/broadcasts",
      file: "wa-broadcast-results.png",
      alt: "Broadcasts list where each sent broadcast appears as a row (none have been sent yet)",
    },
  },

  // ── Additional Quotation Guides ───────────────────────
  {
    slug: "share-quotation",
    title: "How to share a quotation via WhatsApp",
    summary: "Generate a quotation PDF and send it directly to the client through WhatsApp.",
    section: "whatsapp",
    category: "Quotations",
    keywords: ["share", "quotation", "whatsapp", "send", "pdf", "client"],
    steps: [
      { text: "Open **Quotations** from the All Tools menu", target: "wa-sidebar-all-tools" },
      { text: "Create a new quotation or open an existing one", target: "wa-quote-new" },
      { text: "Click **View PDF** to open the quotation document", target: "wa-quote-pdf" },
      { text: "Click **Send** to share the PDF with the client on WhatsApp", target: "wa-quote-send" },
      { text: "Select the contact from the list or enter a phone number", target: "wa-quote-phone" },
      { text: "The quotation is sent as a document message in the chat" },
    ],
    screenshot: {
      path: "/quotations",
      file: "wa-share-quotation.png",
      alt: "Quotations list with the first draft's View PDF and Send actions and a phone number box",
      viewport: { width: 1440, height: 1100 },
    },
  },

  // ── Additional Portfolio Guides ───────────────────────
  {
    slug: "share-portfolio",
    title: "How to share portfolio and court designs",
    summary: "Share your portfolio catalogue or court design via a public link or WhatsApp message.",
    section: "whatsapp",
    category: "Portfolio",
    keywords: ["share", "portfolio", "court", "design", "link", "public", "catalogue"],
    steps: [
      { text: "Open **Portfolio** from the All Tools menu to share a project catalogue", target: "wa-alltools-portfolio" },
      { text: "Click **Generate Catalogue** for a sport to create a shareable PDF" },
      { text: "Use the **Share** button to copy the public link or send via WhatsApp" },
      { text: "For court designs, open **Court Designer** and create or select a layout", target: "wa-alltools-court-images" },
      { text: "Click **Export** and choose **Share link** to get a public URL" },
      { text: "Share the link directly with clients — they can view it without logging in" },
    ],
    screenshot: {
      path: "/portfolio",
      file: "wa-share-portfolio.png",
      alt: "All Tools menu open, showing the Portfolio and Court Designer tools",
      // Opens the All Tools menu only, so the Portfolio and Court Designer entries can be pointed out.
      setup: [
        HYDRATE,
        { type: "click", selector: '[data-guide="wa-sidebar-all-tools"]' },
        { type: "wait", duration: 800 },
      ],
    },
  },

  // ── Additional Ad Campaign Guides ─────────────────────
  {
    slug: "lead-analytics",
    title: "How to view lead analytics",
    summary: "Analyze ad leads by city, sport demand, repeat submitters, and AI-generated insights.",
    section: "whatsapp",
    category: "Ad Campaigns",
    roles: ["admin"],
    keywords: ["lead", "analytics", "city", "sport", "demand", "repeat", "AI", "insight"],
    steps: [
      { text: "Open **Lead Analytics** from the Meta Ads section in All Tools", target: "wa-sidebar-all-tools" },
      { text: "View the city-wise demand breakdown showing which cities generate the most leads", target: "wa-lead-city-title" },
      { text: "Check the **Most-requested sport** chart to see which sports are most popular", target: "wa-lead-sport-title" },
      { text: "Review **Repeat submitters** to identify leads who have submitted multiple times", target: "wa-lead-repeat-kpi" },
      { text: "Use the **Ask AI about your ad campaigns** box for AI-generated insights on your lead data", target: "wa-lead-ai" },
    ],
    screenshot: {
      path: "/ad-campaigns/lead-analytics",
      file: "wa-lead-analytics.png",
      alt: "Lead analytics page with city demand, sport demand, repeat submitters and the Ask AI box",
      viewport: { width: 1440, height: 1750 },
    },
  },

  // ── Additional Admin Guides ───────────────────────────
  {
    slug: "quotation-rates",
    title: "How to configure quotation rates",
    summary: "Set default pricing rates per sport and surface type used in quotation calculations.",
    section: "whatsapp",
    category: "Admin",
    roles: ["admin"],
    keywords: ["rates", "pricing", "quotation", "sport", "surface", "configure", "settings"],
    steps: [
      { text: "Open **Quotation rates** from the Organization section in All Tools" },
      { text: "Select a sport to configure its rate sheet", target: "wa-rates-sport" },
      { text: "Set the per-square-foot or per-square-meter rate for each surface type" },
      { text: "Add pricing for additional items (fencing, lighting, markings, etc.)" },
      { text: "Click **Save changes** — new quotations will use these updated rates", target: "wa-rates-save" },
    ],
    screenshot: {
      path: "/settings/quotation-rates",
      file: "wa-quotation-rates.png",
      alt: "Quotation rates page with sport pricing configuration",
    },
  },
  {
    slug: "chatbot-test",
    title: "How to test the chatbot",
    summary: "Simulate conversations with the chatbot to verify flow paths and responses.",
    section: "whatsapp",
    category: "Admin",
    roles: ["admin"],
    keywords: ["chatbot", "test", "simulate", "flow", "bot", "conversation"],
    steps: [
      { text: "Navigate to the **Chatbot sandbox** page (Admin, at /admin/chatbot-test)" },
      { text: "Type a message in the chat simulator as if you were a customer", target: "wa-chatbot-input" },
      { text: "The chatbot responds following its configured flow paths" },
      { text: "Test different paths (Turnkey, Maintenance, Consultation, Product)", target: "wa-chatbot-path" },
      { text: "Verify that the bot collects the correct information at each step" },
    ],
    screenshot: {
      path: "/admin/chatbot-test",
      file: "wa-chatbot-test.png",
      alt: "Chatbot test page with conversation simulator",
    },
  },
  {
    slug: "sport-tds",
    title: "How to manage sport TDS sheets",
    summary: "Upload and organize Technical Data Sheets for each sport's flooring and surface products.",
    section: "whatsapp",
    category: "Admin",
    roles: ["admin"],
    keywords: ["TDS", "technical", "data", "sheet", "sport", "flooring", "upload"],
    steps: [
      { text: "Navigate to the **Sport TDS uploads** page (Admin, at /admin/sport-tds)" },
      { text: "Find the sport to view its linked TDS documents" },
      { text: "Click **Upload** to add a new Technical Data Sheet", target: "wa-tds-upload" },
      { text: "Each TDS is linked to its product and appears in quotation PDFs" },
      { text: "Click **Remove** to delete an outdated TDS document" },
    ],
    screenshot: {
      path: "/admin/sport-tds",
      file: "wa-sport-tds.png",
      alt: "Sport TDS management page with document list",
    },
  },
  {
    slug: "audit-log",
    title: "How to view the audit log",
    summary: "Review a chronological record of all stage changes, role changes, and taxonomy edits.",
    section: "whatsapp",
    category: "Admin",
    roles: ["admin"],
    keywords: ["audit", "log", "history", "changes", "track", "record"],
    steps: [
      { text: "Open **Audit log** from the Admin section in All Tools" },
      { text: "View a chronological list of all changes made in the platform", target: "wa-audit-list" },
      { text: "Each entry shows who made the change, what changed, and when" },
      { text: "Filter by date range to narrow down to a specific period" },
      { text: "Use the audit log to track stage changes, role updates, and taxonomy edits" },
    ],
    screenshot: {
      path: "/admin/audit-log",
      file: "wa-audit-log.png",
      alt: "Audit log showing change history entries",
    },
  },
  {
    slug: "ai-usage",
    title: "How to track AI usage",
    summary: "Monitor who is using AI features, request counts, and estimated spend.",
    section: "whatsapp",
    category: "Admin",
    roles: ["admin"],
    keywords: ["AI", "usage", "cost", "requests", "spend", "monitor"],
    steps: [
      { text: "Open **AI usage** from the Admin section in All Tools" },
      { text: "View the total AI requests and estimated spend for the current period", target: "wa-ai-chart" },
      { text: "See a breakdown by team member to identify who uses AI the most", target: "wa-ai-breakdown" },
      { text: "Monitor usage trends over time to manage costs" },
      { text: "Use this data to set usage guidelines for your team" },
    ],
    screenshot: {
      path: "/admin/ai-usage",
      file: "wa-ai-usage.png",
      alt: "AI usage page with request counts and spend breakdown",
    },
  },
];

export const WHATSAPP_RECORDING: SectionRecording = {
  slug: "whatsapp-overview",
  title: "WhatsApp Dashboard Overview",
  section: "whatsapp",
  startUrl: "/inbox",
  actions: [
    { type: "caption", text: "WhatsApp Marketing — send messages, manage contacts, and capture leads via WhatsApp", duration: 3000 },

    { type: "caption", text: "The Inbox shows all customer conversations — open, closed, and unread messages in one place" },
    { type: "highlight", selector: "[data-guide='wa-inbox']", label: "Inbox" },
    { type: "caption", text: "Click any conversation to read messages, send replies, share media, and use quick replies" },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "Broadcasts let you send bulk WhatsApp messages to filtered contact lists" },
    { type: "click", selector: "[data-guide='wa-sidebar-broadcasts']" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "Create a new broadcast — pick a template, select recipients, and schedule or send immediately" },
    { type: "highlight", selector: "[data-guide='wa-broadcast-create']", label: "Create Broadcast" },

    { type: "caption", text: "Contacts — your full WhatsApp address book with tags, notes, and conversation history" },
    { type: "click", selector: "[data-guide='wa-sidebar-contacts']" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "Search, filter, and export contacts — detect duplicates and merge them automatically" },
    { type: "scroll", direction: "down", amount: 400 },
    { type: "wait", duration: 1500 },

    { type: "caption", text: "Reminders — schedule follow-ups so you never miss a callback or meeting" },
    { type: "click", selector: "[data-guide='wa-sidebar-reminders']" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "You'll get push notifications when a reminder is due — even on your phone" },
    { type: "wait", duration: 1500 },

    { type: "caption", text: "Bot Leads — every lead captured by the WhatsApp chatbot appears here with their details" },
    { type: "highlight", selector: "[data-guide='wa-sidebar-leads']", label: "Bot Leads" },
    { type: "caption", text: "View lead source, ad campaign, and conversation — then move them into the CRM pipeline" },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "Also available: Templates, Quotations, Portfolio sharing, and Admin settings — explore each guide below", duration: 3000 },
  ],
};
