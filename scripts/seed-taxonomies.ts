// Phase 1 taxonomy seed. All values below are copied verbatim from the
// build spec (fitoverse_crm_feature_spec.md) — real, spec-supplied content,
// not invented. The one deliberate exception is CityTier: only the 3 generic
// tier labels are seeded (per spec §4.3), NOT a city->tier mapping — which
// city belongs to which tier is data gap #1 in docs/DATA_GAPS.md and stays
// unresolved until Fitoverse supplies it.
//
// Idempotent (upsert on the unique slug), safe to re-run.
//   DATABASE_URL="$DEV_DATABASE_URL" npx tsx scripts/seed-taxonomies.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// §5.1 — 13 seed stages, exact order/type from the spec. Colors progress
// neutral -> engaged -> in-process -> closing-heat, with the two terminal
// outcomes using the real Fitoverse brand colors (green for won, red for
// lost) so they read unambiguously against the rest of the ramp. "Dropped /
// Cold" gets a cooler gray rather than red — it's a passive non-outcome,
// not an active rejection, and shouldn't look the same as "Lost — Rejected".
const FUNNEL_STAGES: Array<{
  name: string;
  stageType: "active" | "won" | "lost";
  requiresLossReason?: boolean;
  colorHex: string;
}> = [
  { name: "Enquiry Received", stageType: "active", colorHex: "#64748b" },
  { name: "Contacted / Qualified", stageType: "active", colorHex: "#3b82f6" },
  { name: "Site Visit Scheduled", stageType: "active", colorHex: "#0ea5e9" },
  { name: "Site Visit Done", stageType: "active", colorHex: "#06b6d4" },
  { name: "Sample Sent", stageType: "active", colorHex: "#14b8a6" },
  { name: "Design Shared", stageType: "active", colorHex: "#8b5cf6" },
  { name: "Quotation Sent", stageType: "active", colorHex: "#6366f1" },
  { name: "Proposal Sent", stageType: "active", colorHex: "#a855f7" },
  { name: "Negotiation", stageType: "active", colorHex: "#f59e0b" },
  { name: "Verbal Confirmation", stageType: "active", colorHex: "#f97316" },
  { name: "Won — PO / Advance Received", stageType: "won", colorHex: "#159341" },
  { name: "Lost — Rejected", stageType: "lost", requiresLossReason: true, colorHex: "#c81124" },
  { name: "Dropped / Cold", stageType: "lost", requiresLossReason: true, colorHex: "#94a3b8" },
];

// §6.1 — lead sources, flat list (no parent grouping seeded yet — the
// spec's optional "Paid Ads" grouping is left for the admin taxonomy UI).
const LEAD_SOURCES = [
  "Referral — Customer",
  "Referral — Architect",
  "Referral — Contractor",
  "Google Ads",
  "Google Organic / SEO",
  "Meta Ads — Facebook",
  "Meta Ads — Instagram",
  "YouTube Ads",
  "YouTube Organic",
  "WhatsApp Inbound",
  "Walk-in",
  "Phone Call Inbound",
  "Exhibition / Event",
  "Cold Outreach",
  "Existing Customer — Repeat",
  "Partner / Dealer",
  "Website Form",
  "JustDial / IndiaMART",
  "Other",
];

// §4.2 — 16 seed values.
const CUSTOMER_PROFILES = [
  "School",
  "College / University",
  "Sports Academy Owner",
  "Sports Club",
  "Real Estate Developer",
  "Architect",
  "Contractor / Builder",
  "Corporate Office",
  "Hotel / Resort",
  "Government / Municipal",
  "Residential — Individual",
  "Gated Community / RWA",
  "Gym / Fitness Centre",
  "Turf Business Operator",
  "NGO / Trust",
  "Other",
];

// §4.3 — generic tier labels only, not a city mapping (see file comment above).
const CITY_TIERS = ["Tier 1", "Tier 2", "Tier 3"];

// §5.4 — 12 seed values.
const LOSS_REASONS = [
  "Price Too High",
  "Competitor Won",
  "Budget Not Approved",
  "Project Postponed",
  "Project Cancelled",
  "Land / Site Issue",
  "Went With Local Contractor",
  "No Response / Gone Cold",
  "Spec Mismatch",
  "Timeline Not Feasible",
  "Out Of Service Area",
  "Other",
];

// §8.1 — 13 seed values.
const ACTIVITY_TYPES = [
  "Inbound Call",
  "Outbound Call",
  "WhatsApp Conversation",
  "Email",
  "Site Visit",
  "Google Meet",
  "In-Person Meeting",
  "Sample Dispatch",
  "Design Presentation",
  "Quotation Walkthrough",
  "Negotiation Meeting",
  "Follow-up",
  "Site Measurement",
];

// Matches the two independently-duplicated hardcoded unions in
// src/lib/quotation/rates.ts (SUPPORTED_SPORTS) and src/lib/products/store.ts
// (SPORT_KEYS) — kept in the same order for easy eyeballing.
const SPORTS = ["football", "cricket", "basketball", "pickleball", "tennis", "badminton", "volleyball", "multisport"];

async function seedSimple(
  model: { upsert: (args: any) => Promise<any> },
  names: string[],
  extra?: (name: string, i: number) => Record<string, unknown>
) {
  let i = 0;
  for (const name of names) {
    const slug = slugify(name);
    const data = { name, slug, sortOrder: i, ...(extra ? extra(name, i) : {}) };
    await model.upsert({ where: { slug }, create: data, update: { name, sortOrder: i, ...(extra ? extra(name, i) : {}) } });
    i++;
  }
  console.log(`  ${names.length} rows`);
}

async function main() {
  console.log("FunnelStage:");
  let i = 0;
  for (const s of FUNNEL_STAGES) {
    const slug = slugify(s.name);
    const data = {
      name: s.name,
      slug,
      sortOrder: i,
      stageType: s.stageType,
      requiresLossReason: s.requiresLossReason ?? false,
      colorHex: s.colorHex,
    };
    await prisma.funnelStage.upsert({ where: { slug }, create: data, update: data });
    i++;
  }
  console.log(`  ${FUNNEL_STAGES.length} rows`);

  console.log("LeadSource:");
  await seedSimple(prisma.leadSource, LEAD_SOURCES);

  console.log("CustomerProfile:");
  await seedSimple(prisma.customerProfile, CUSTOMER_PROFILES);

  console.log("CityTier:");
  await seedSimple(prisma.cityTier, CITY_TIERS);

  console.log("LossReason:");
  await seedSimple(prisma.lossReason, LOSS_REASONS);

  console.log("ActivityType:");
  await seedSimple(prisma.activityType, ACTIVITY_TYPES);

  console.log("Sport:");
  i = 0;
  for (const slug of SPORTS) {
    const name = slug.charAt(0).toUpperCase() + slug.slice(1);
    const data = { slug, name, sortOrder: i };
    await prisma.sport.upsert({ where: { slug }, create: data, update: data });
    i++;
  }
  console.log(`  ${SPORTS.length} rows`);

  // One LeadSource row is needed immediately by Phase 1's chatbot dual-write
  // (src/lib/chatbot/dispatch.ts) — confirm it landed with the expected slug.
  const botSource = await prisma.leadSource.findUnique({ where: { slug: "whatsapp_inbound" } });
  console.log("\nchatbot lead source ->", botSource?.id ?? "MISSING — check WHATSAPP_INBOUND slug");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
