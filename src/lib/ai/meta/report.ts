// Phase 6 (Meta ad-campaign AI summaries) — the report runner. Builds the Meta
// ads toolbox and runs the manual tool loop: the model answers the question
// ONLY by calling tools, so every number in the narrative traces back to a real
// DB query (never invented). Tool outputs are returned verbatim as dataBlocks
// so the UI can show the evidence beneath the prose. Internal-assist only —
// read-only reporting over ad-campaign data, nothing here touches a customer.
// Distinct feature key ("meta_summary") keeps AI usage-cap/accounting separate
// from the CRM analytics reports.
import { runToolLoop } from "@/lib/ai/tools";
import { buildMetaAdsToolbox } from "./toolbox";

export type MetaAdsDataBlock = { tool: string; title: string; rows: unknown };
export type MetaAdsReportResult = { narrative: string; dataBlocks: MetaAdsDataBlock[] };

// Human-readable section titles for each tool's data block. Falls back to a
// title-cased tool name so a newly-added tool never renders a raw slug.
const TOOL_TITLES: Record<string, string> = {
  campaign_performance: "Campaign performance",
  lead_volume: "Lead volume",
  spend_vs_leads: "Spend vs leads",
  cost_per_lead: "Cost per lead",
  best_worst_campaigns: "Best & worst campaigns",
};

function titleFor(tool: string): string {
  return TOOL_TITLES[tool] ?? tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function runMetaAdsReport(opts: {
  userId: string;
  question: string;
}): Promise<MetaAdsReportResult> {
  const tools = buildMetaAdsToolbox("last_30_days");

  // Real-data-only + not-enough-data language copied VERBATIM from
  // ai/analytics/report.ts, retargeted to ad-campaign data.
  const system =
    "You are Fitoverse's ad-campaign data assistant. Answer ONLY using the tools — you have NO knowledge of Fitoverse's Meta/Facebook/Instagram ad numbers except what the tools return in THIS session. NEVER invent, estimate, extrapolate, or use example/illustrative numbers, and never fall back on general knowledge for any figure. " +
    "If the tools return no data, an empty result, an error, or n=0 for what was asked, DO NOT guess or fabricate: reply plainly that you don't have enough data for that specific question, and suggest one or two other things they could ask (a different time period, or a metric you DO have data for). " +
    "TIME WINDOW: if the question names a period in words ('last week', 'yesterday', 'last 7 days', 'in July', 'so far this month', 'between 1 and 15 August') or gives explicit dates, work out the exact from/to dates from today's date and pass them to the tool as customRange { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } — do not rely on the default window in that case. Weeks run Monday to Sunday. " +
    "Spend and cost-per-lead (CPL) are in INR. Always state how many campaigns or leads the numbers are based on and flag thin data (a handful of leads is not reliable). Today is " +
    new Date().toISOString().slice(0, 10) +
    ". Be concise; lead with the answer.";

  const { text, toolResults } = await runToolLoop({
    feature: "meta_summary",
    userId: opts.userId,
    system,
    user: opts.question,
    tools,
    cacheSystem: true,
    maxRounds: 6,
  });

  return {
    narrative: text,
    dataBlocks: toolResults.map((r) => ({ tool: r.name, title: titleFor(r.name), rows: r.output })),
  };
}
