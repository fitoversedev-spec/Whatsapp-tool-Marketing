import { buildAnalyticsToolbox, type PeriodInput } from "@/lib/ai/analytics/toolbox";
import type { AnalyticsScope } from "@/lib/analytics/scope";
import type { RepDealRow } from "@/lib/analytics/repDeals";
import { AgentHttpError } from "../errors";
import { ANALYTICS_REPORTS, type AnalyticsInput, type AnalyticsReport } from "../schemas/read";
import { shapeKpiBoard, stripInternalKeys, toOpenDealRow } from "./analyticsShape";

/**
 * The agent reads the same company-wide aggregates the in-app analytics
 * assistant does, through the same toolbox. The scope is built here, directly:
 * the agent is never given the admin role, and cannot name a rep (the toolbox's
 * repName input is simply never passed).
 */
export const AGENT_ANALYTICS_SCOPE: AnalyticsScope = { companyWide: true };

const TOOL_FOR_REPORT: Record<AnalyticsReport, string> = {
  kpi_board: "kpi_board",
  funnel: "pipeline_funnel",
  products: "product_analytics",
  geography: "geography_cities",
  sources: "lead_source_analytics",
  seasonality: "seasonality",
  open_deals: "open_deals_by_rep",
};

export function parseReport(raw: string | undefined): AnalyticsReport {
  if (raw && (ANALYTICS_REPORTS as readonly string[]).includes(raw)) return raw as AnalyticsReport;
  throw new AgentHttpError("not_found", `Unknown report. Use one of: ${ANALYTICS_REPORTS.join(", ")}.`);
}

export async function getAnalytics(report: AnalyticsReport, input: AnalyticsInput) {
  const tool = buildAnalyticsToolbox(AGENT_ANALYTICS_SCOPE).find((t) => t.name === TOOL_FOR_REPORT[report]);
  if (!tool) throw new AgentHttpError("internal", "Report is not available.");

  const period: PeriodInput = input.from && input.to ? { from: input.from, to: input.to } : (input.period ?? "all_time");
  const result = (await tool.handler(
    input.from && input.to ? { customRange: { from: input.from, to: input.to } } : { period: input.period },
  )) as unknown;
  if (result && typeof result === "object" && "error" in result && typeof (result as { error: unknown }).error === "string") {
    throw new AgentHttpError("invalid_input", (result as { error: string }).error);
  }

  if (report === "open_deals") {
    const rows = (result as RepDealRow[]).map(toOpenDealRow);
    const start = (input.page - 1) * input.limit;
    return {
      report,
      period,
      data: rows.slice(start, start + input.limit),
      page: { page: input.page, limit: input.limit, total: rows.length, hasMore: start + input.limit < rows.length },
    };
  }
  return {
    report,
    period,
    data: report === "kpi_board" ? shapeKpiBoard(result as Parameters<typeof shapeKpiBoard>[0]) : stripInternalKeys(result),
  };
}
