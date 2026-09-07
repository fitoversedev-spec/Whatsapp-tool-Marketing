# Fitoverse Platform — Feature List

> **Last updated:** 7 September 2026 (v2)
>
> When a new feature is added, update this file in the same commit.
> Add it under the correct module and section. Keep numbering sequential.

---

## 1. WhatsApp Marketing

### 1.1 Inbox
- Real-time message display (text, images, documents, video, audio)
- Assign conversations to specific team members
- Pipeline stage tracking per conversation
- Deal value tracking per conversation
- Unread count badges
- Conversation notes and labels for internal tagging
- Move a conversation contact into the CRM as a lead or account contact

### 1.2 Contacts
- Phone number (E.164 format, unique), name, custom fields
- Campaign consent flag (allowCampaign)
- Tags for segmentation
- Import contacts from CSV or Google Sheets
- Bulk operations (tag, delete, export)
- Duplicate detection and merge
- Filter, search, and export
- Link to CRM account contact (if promoted)

### 1.3 Broadcasts
- Choose recipients from contacts, a CSV file, or a Google Sheet
- Select an approved WhatsApp template
- Map template variables to contact fields
- Schedule for a future time or send immediately
- Pause and resume mid-broadcast
- Pacing control (configurable send rate, default 120ms between messages, chunks of 50)
- Live delivery stats: sent, delivered, read, failed counters
- Export recipient list with delivery status
- Status lifecycle: Draft, Scheduled, Running, Paused, Completed, Failed

### 1.4 Templates
- Create templates with header (text/image/document/video), body (with variable placeholders), footer, and buttons (quick reply, URL, phone)
- Submit templates to Meta for approval
- Sync template status from Meta (approved, rejected, paused)
- AI-assisted template drafting
- Preview before sending
- Track which templates are used in broadcasts

### 1.5 Auto-Replies
- Keyword matching rules
- After-hours gate (different replies outside business hours)
- Cooldown periods to avoid spam
- Firing audit log

### 1.6 Chatbot
- State machine with defined paths and steps
- Collects structured data (name, location, sport interest, etc.)
- Captured leads stored in BotLead table
- Staff can receive WhatsApp bot commands for confirmations

### 1.7 Tags & Labels
- Tags applied to contacts for segmentation (used to filter broadcast recipients)
- Labels applied to conversations for internal workflow (e.g. Follow up, Hot lead, Complaint)

### 1.8 Media Library
- Centralised storage for images, videos, and documents
- Used in WhatsApp messages, templates, and broadcasts

### 1.9 Meta Ad Campaigns (Lead Ads)
- Sync leads captured from Meta Lead Ad forms
- Field mapping from Meta form fields to contact fields
- Per-campaign lead list and analytics
- Move ad leads into marketing contacts or CRM
- Lead notes, labels, and AI-powered summarisation

### 1.10 Analytics
- Broadcast delivery rates (sent, delivered, read, failed)
- Conversation volume and response times
- Template performance comparison
- Contact growth over time
- Usage heatmaps
- AI-generated analytics reports

---

## 2. CRM (Customer Relationship Management)

### 2.1 Dashboard
- Admin view: team-wide KPIs (quotations sent, total quoted value, deals won, won value, month-over-month deltas)
- Rep view: "My Day" personal dashboard (due/overdue reminders, stuck deals, deals closing within 7 days)

### 2.2 Accounts (Companies)
- Business type classification (B2B, B2C, B2G)
- Customer profile categorisation
- City and city tier
- GSTIN (tax ID)
- Hierarchical parent-child relationships
- Owner assignment (which sales rep owns this account)
- Duplicate detection (by GSTIN, phone, name) and merge

### 2.3 Account Contacts
- Name, phone (E.164), email, designation
- Linked to an Account with primary contact flag
- Notes and file attachments
- Promotion path to Lead status
- Sync to/from marketing contacts
- Bulk operations (delete, pipeline stage change)

### 2.4 Leads
- Status workflow: New > Contacted > Qualified > Disqualified
- Lead source tracking (hierarchical)
- Owner assignment
- Convert to Deal (creates a Deal record, links via convertedDealId)

### 2.5 Deals & Pipeline
- Sequential code: FIT-DL-2026-001
- Configurable funnel stages with SLA hours, probability percentages, and colour coding
- Kanban board: drag-and-drop deals between stages
- Stage history: every transition recorded with timestamp and duration (append-only audit trail)
- Values: estimated value, quoted value, won value
- Outcome: Won, Lost (with loss reason), or Dropped
- Site city and location tracking
- Expected close date
- Execution status tracking
- Next action notes
- Interested products linked to each deal
- Timeline: unified view of all activities, notes, stage changes, quotations, and invoices

### 2.6 Activities
- Configurable activity types: calls, site visits, samples sent, meetings, emails (with colour coding)
- Subject, date/time, duration, outcome
- Owner assignment
- Filterable unified view across all entities (deals, leads, accounts, contacts)

### 2.7 Reminders & Tasks
- Linked to deals or contacts
- Priority levels and due dates with overdue tracking
- Recurrence rules (daily, weekly, monthly)
- Snooze capability and completion notes
- WhatsApp channel dispatch for notifications
- Activity type linking (e.g. call reminder creates a call activity on completion)

### 2.8 Quotations
- Versioned per deal (multiple revisions, with isPrimary flag)
- Line items with product, sport, quantity, rate, amount
- Enquiry-only items (not priced)
- Grand total calculation
- PDF generation
- Send via WhatsApp
- Convert to Invoice
- Configurable rate sheets (Settings > Quotation Rates)

### 2.9 Invoices
- Status: Issued > Sent > Partially Paid > Paid > Overdue > Cancelled
- Due date tracking
- Payment recording (amount, date, method)
- Amount paid vs outstanding calculation
- Send via WhatsApp

### 2.10 Import
- CSV and Google Sheets import
- Target types: Contacts, Companies, Leads, Deals
- Preview before committing
- Duplicate detection during import
- Row-level success/error reporting
- Undo capability (per import batch)

### 2.11 Analytics
- Sales activity tables
- Funnel analysis and stage velocity
- Product conversion rates
- Lead source ROI
- Geographic heatmaps
- Cohort analysis
- Rep comparison quadrants
- Win/loss segmentation
- Anomaly detection
- Revenue targets vs actual (per user, per company, monthly/quarterly/FY)
- Invoice analytics (billed vs collected, payment timelines)
- AI-generated narrative reports
- Export any table or chart as CSV

### 2.12 Admin
- Taxonomies: manage activity types, lead sources, loss reasons, business types, customer profiles, city tiers
- Targets: revenue and deal count targets per user or company-wide
- Audit log: every significant action logged with user, timestamp, entity, and change details
- AI usage: track Claude API usage across the platform

---

## 3. Site Scout

### 3.1 Dashboard
- Saved scans grid (newest first)
- Scan count this month
- Active salespeople count
- Quick-compare chips (top 3 scans)

### 3.2 Scan Area
- Address entry with geocode lookup
- Google Maps URL paste-to-navigate (extract coordinates from shared link)
- Radius selection with proportionally aligned presets
- Category picker with sport presets (12 formats)
- Nearby places: Schools, Colleges, Kindergarten, Workplaces, IT Companies, Apartments
- Field notes input
- Run scan (tiled Places search with overlapping ~800m sub-circles)
- View scan results: facilities list, demand anchors list
- Facility details (hours, price level, website, phone, reviews)
- Score panel (5-component breakdown)
- Saturation panel
- Verdict badge (Proceed / Investigate / Avoid)
- Map with colour-coded markers (green = facilities, blue = demand, red = plot)
- Distance line from plot to selected facility on map
- Customer markers (user-placed annotations)
- Archive / delete scan

### 3.3 Find Spaces
- Full-screen map exploration
- Search bar (geocode by place name or city)
- Map / Satellite toggle
- Right-click reverse geocode (get address from any point)
- Coordinates display
- View on Google Maps link
- Street View link
- Zoom controls
- "Scan this area" button (prefills Scan Area screen)

### 3.4 Compare
- Side-by-side comparison of 2-3 scans
- Score breakdown per component
- Best value highlighting per row
- Scan picker

### 3.5 Report Studio
- Report name input (asked before generating)
- Custom notes (included in AI-generated report)
- "Our Suggestions" section (custom recommendations)
- AI analysis: best sport, revenue potential, competition, area suitability
- Include/exclude toggles for report sections
- Generate PDF (HTML > Puppeteer > PDF > blob storage > signed URL)
- Preview in browser
- Regenerate new versions
- Shareable link with expiry date
- Version tracking

### 3.6 WhatsApp Share
- One-tap share via wa.me deep link with signed PDF URL
- Delivery logged against scan
- Scan marked as "Report sent" on dashboard

### 3.7 Saved Scans
- List view with area name, radius, date, owner, customer name
- Facility count and score badge per row
- Multi-select bulk delete
- Archive individual scan
- Link to new site check

### 3.8 Reports List
- All generated PDF reports (newest first)
- Report count
- Multi-select bulk delete

### 3.9 Scoring System
- 100-point site viability score across 5 components:
  - Demand Anchors (30 pts): weighted count of demand-generating places with distance decay
  - Competitive Saturation (20 pts): facilities per unit of demand vs city benchmark
  - Market Proof (15 pts): Google review volume (total + median per facility)
  - Service Gap (20 pts): rating gaps (8), concentration (4), unserved sports (4), AI complaint themes (4)
  - Site Practicals (15 pts): 14-field surveyor checklist (road access, parking, utilities, drainage, flood risk)
- Saturating curve per component (diminishing returns)
- Verdict bands: 70+ Proceed, 50-69 Investigate, below 50 Avoid
- Components 2 and 3 pull against each other (empty field = high saturation + low market proof = "no market" signal)

### 3.10 Admin — Users
- Approve/reject signups
- Assign admin or sales roles
- Self-signup with first account as admin

### 3.11 Admin — Scoring Weights
- Redistribute the 100 points with sliders (must total 100)
- Edit / Cancel / Reset controls
- Save as new model version
- Version history table
- Activate any previous version
- Existing scans keep their original model's score

### 3.12 Admin — Usage
- Total scans (last 30 days)
- Total API calls
- Estimated cost in USD + INR
- Cache hit rate
- Daily call cap display
- Per team member breakdown (scans, API calls, cost, last scan date)

---

## 4. Shared / Cross-Module

### 4.1 Authentication
- Email/password self-signup
- First account becomes admin, subsequent users need approval
- Admin / Sales roles with RBAC
- Sign out

### 4.2 Court Designer
- 2D and 3D court layout designer
- Multiple sport types
- Material calculator
- Design attachments
- Court image gallery

### 4.3 Products
- Product catalogue management
- Product media and TDS files
- Sport-specific catalogues with PDF generation

### 4.4 Portfolio
- Portfolio project management
- Public share links

### 4.5 Internal Team Chat
- Chat threads with messages
- File attachments
- Read receipts
- Handoff between team members
- Mentions and availability status

### 4.6 AI Layer (Claude)
- Template drafting (WhatsApp Marketing)
- Analytics narrative reports (CRM)
- Review theme extraction (Site Scout)
- Report generation (Site Scout)
- Insight feeds across the platform

### 4.7 WhatsApp Delivery
- Shared Meta WhatsApp Business API connection
- Cloud API vs WhatsApp Web routing based on 24h session window
- Used by: broadcasts, conversation replies, report PDFs, quotation PDFs, invoice PDFs, reminder notifications
