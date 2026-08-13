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
  by_city: "Leads by city",
  by_sport: "Sport demand",
  repeat_leads: "Repeat submitters",
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
    "Spend and cost-per-lead (CPL) are in INR. Always state how many campaigns or leads the numbers are based on and flag thin data (a handful of leads is not reliable). " +
    "You MAY close with a short 'Recommendations' line or paragraph (at most 2-3 sentences) of practical next steps — but every suggestion must follow DIRECTLY from a pattern visible in the rows the tools returned this session (e.g. a city or sport with clearly more leads than the rest, a repeat submitter worth a personal call, a campaign with wasted spend). Do NOT introduce any new number, benchmark, target, or fact a tool did not return, and do not recommend anything the returned data doesn't support; if the data is too thin to justify a recommendation, say so instead of inventing one. " +
    "EFFICIENCY: call every tool you need for the answer in as few turns as possible — request multiple tools together in one turn rather than one per turn. campaignName matching is fuzzy, so pass a rough campaign name ONCE and trust the result; do not retry a tool with different spellings after a match. Format the answer as clean Markdown (a short heading, a compact metrics table where useful, and tight prose). Today is " +
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

  // Clean the tool trace for the (collapsed) "underlying data" appendix: drop
  // error/empty results and keep only the LAST successful call per tool — the
  // model often calls the same tool more than once (e.g. all-campaigns then a
  // named one), and the raw every-round dump was noisy and confusing.
  const isErr = (o: unknown): boolean =>
    !!o && typeof o === "object" && "error" in (o as Record<string, unknown>);
  const byTool = new Map<string, MetaAdsDataBlock>();
  for (const r of toolResults) {
    if (isErr(r.output)) continue;
    byTool.set(r.name, { tool: r.name, title: titleFor(r.name), rows: r.output });
  }

  return { narrative: text, dataBlocks: [...byTool.values()] };
}
