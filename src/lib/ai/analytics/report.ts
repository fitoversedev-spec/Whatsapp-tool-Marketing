// Feature 2 (AI analytics reports) — the report runner. Builds the analytics
// toolbox for the caller's scope and runs the manual tool loop: the model
// answers the question ONLY by calling tools, so every number in the narrative
// traces back to a real DB query (never invented). The tool outputs are
// returned verbatim as dataBlocks so the UI/PDF can show the evidence beneath
// the prose. Internal-assist only — read-only admin reporting, nothing here
// touches a customer.
import type { AnalyticsScope } from "@/lib/analytics/scope";
import { runToolLoop } from "@/lib/ai/tools";
import { buildAnalyticsToolbox, type PeriodInput } from "./toolbox";

export type AiReportDataBlock = { tool: string; title: string; rows: unknown };
export type AiReportResult = { narrative: string; dataBlocks: AiReportDataBlock[] };

// Human-readable section titles for each tool's data block. Falls back to a
// title-cased tool name so a newly-added tool never renders a raw slug.
const TOOL_TITLES: Record<string, string> = {
  kpi_board: "KPI board",
  sales_activity_by_rep: "Sales activity by rep",
  rep_comparison: "Rep comparison",
  target_progress: "Target vs actual",
  product_analytics: "Product analytics (flooring)",
  geography_cities: "Geography — cities & tiers",
  lead_source_analytics: "Lead source performance",
  pipeline_funnel: "Pipeline funnel & loss reasons",
  stage_velocity: "Stage velocity",
  win_loss_by_segment: "Win/loss by segment",
  seasonality: "Seasonality by sport",
  invoice_analytics: "Invoicing & collections",
  open_deals_by_rep: "Open deals by rep (live workload)",
  find_person: "Person lookup",
  deal_detail: "Deal detail",
  quotation_lookup: "Quotation lookup",
  invoice_lookup: "Invoice lookup",
};

function titleFor(tool: string): string {
  return TOOL_TITLES[tool] ?? tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function runAiReport(opts: {
  userId: string;
  question: string;
  period?: PeriodInput;
  scope: AnalyticsScope;
}): Promise<AiReportResult> {
  const tools = buildAnalyticsToolbox(opts.scope, opts.period ?? "all_time");

  const system =
    "You are Fitoverse's sales-data assistant. Answer ONLY using the tools — you have NO knowledge of Fitoverse's numbers except what the tools return in THIS session. NEVER invent, estimate, extrapolate, or use example/illustrative numbers, and never fall back on general knowledge for any figure. " +
    "If the tools return no data, an empty result, an error, or n=0 for what the user asked about, DO NOT guess, fabricate, or suggest alternatives — your ENTIRE reply must be exactly this sentence, verbatim, with nothing before or after it: we don't have data for your request. " +
    "For a question about a SPECIFIC named person, company, deal, quotation or invoice, use the record-lookup tools (find_person, deal_detail, quotation_lookup, invoice_lookup) rather than the aggregate tools — pass the name/number as given even if it looks misspelled or wrong-case, because matching is fuzzy; do not retry different spellings. " +
    "TIME WINDOW: if the question names a period in words ('last week', 'yesterday', 'last 7 days', 'in July', 'so far this month', 'between 1 and 15 August') or gives explicit dates, work out the exact from/to dates from today's date and pass them to the tool as customRange { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } — do not rely on the default window in that case. Weeks run Monday to Sunday. " +
    "When there IS data, state the sample size n and flag insufficient data (fewer than ~5 records is not reliable). Format the answer as clean Markdown (a short heading, a compact table where useful, and tight prose). Today is " +
    new Date().toISOString().slice(0, 10) +
    ". Financial year is Apr-Mar. Be concise; lead with the answer.";

  const { text, toolResults } = await runToolLoop({
    feature: "analytics",
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
