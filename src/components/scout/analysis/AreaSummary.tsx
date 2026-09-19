"use client";

import { Badge } from "@/components/scout/ui";

export interface AreaSummaryData {
  marketSaturation: { level: string; explanation: string };
  opportunityScore: { score: number; reasoning: string };
  risks: string[];
  executiveRecommendation: string;
  competitorLearnings?: { complaint: string; seenAt: string; ourRule: string }[];
  opportunities?: { title: string; detail: string }[];
  promotionPlan?: { channel: string; action: string; timeline: string }[];
  launchChecklist?: { task: string; priority: string; when: string }[];
  oneLineStrategy?: string;
}

export interface AreaSummaryProps {
  summary: AreaSummaryData;
  className?: string;
}

const saturationTone: Record<string, "green" | "blue" | "red" | "neutral"> = {
  Low: "green",
  Moderate: "blue",
  High: "red",
  Oversaturated: "red",
};

export function AreaSummary({ summary, className }: AreaSummaryProps) {
  const scorePct = Math.min(summary.opportunityScore.score * 10, 100);
  const scoreColor =
    summary.opportunityScore.score >= 7
      ? "bg-court-500"
      : summary.opportunityScore.score >= 4
        ? "bg-amber-400"
        : "bg-red-400";

  return (
    <div className={["flex flex-col gap-4", className].filter(Boolean).join(" ")}>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Market Saturation</span>
          <Badge tone={saturationTone[summary.marketSaturation.level] ?? "neutral"}>
            {summary.marketSaturation.level}
          </Badge>
        </div>
        <p className="m-0 text-[12.5px] text-slate-600 leading-[1.6]">{summary.marketSaturation.explanation}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Opportunity Score</span>
          <span className="text-[15px] font-bold text-slate-800">{summary.opportunityScore.score}/10</span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mb-2">
          <div className={`h-full rounded-full transition-all duration-500 ${scoreColor}`} style={{ width: `${scorePct}%` }} />
        </div>
        <p className="m-0 text-[12.5px] text-slate-600 leading-[1.6]">{summary.opportunityScore.reasoning}</p>
      </div>

      {summary.risks.length > 0 ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3.5">
          <span className="text-[12px] font-semibold text-red-700 uppercase tracking-wide">Identified Risks</span>
          <ul className="m-0 mt-2 pl-4 flex flex-col gap-1">
            {summary.risks.map((risk, i) => (
              <li key={i} className="text-[12.5px] text-red-700 leading-[1.6]">{risk}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-court-200 bg-court-50 px-4 py-3.5">
        <span className="text-[12px] font-semibold text-court-700 uppercase tracking-wide">Executive Recommendation</span>
        <p className="m-0 mt-2 text-[13px] text-court-900 leading-[1.65] font-medium">{summary.executiveRecommendation}</p>
      </div>

      {summary.oneLineStrategy ? (
        <div className="rounded-lg bg-slate-900 px-4 py-3.5">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">The Pitch</span>
          <p className="m-0 mt-1.5 text-[13.5px] text-white leading-[1.6] italic">&ldquo;{summary.oneLineStrategy}&rdquo;</p>
        </div>
      ) : null}

      {(summary.competitorLearnings?.length ?? 0) > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
          <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Competitor Learnings</span>
          <div className="mt-2 flex flex-col gap-2">
            {summary.competitorLearnings!.map((l, i) => (
              <div key={i} className="border-l-2 border-amber-400 pl-3 py-1">
                <p className="m-0 text-[12px] text-slate-700">{l.complaint} <span className="text-slate-400">— {l.seenAt}</span></p>
                <p className="m-0 mt-0.5 text-[12px] font-semibold text-court-700">{l.ourRule}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(summary.opportunities?.length ?? 0) > 0 ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3.5">
          <span className="text-[12px] font-semibold text-blue-700 uppercase tracking-wide">Market Opportunities</span>
          <div className="mt-2 flex flex-col gap-2">
            {summary.opportunities!.map((o, i) => (
              <div key={i}>
                <span className="text-[12.5px] font-semibold text-blue-900">{o.title}</span>
                <p className="m-0 mt-0.5 text-[12px] text-blue-800 leading-[1.5]">{o.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(summary.promotionPlan?.length ?? 0) > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
          <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Promotion Plan</span>
          <div className="mt-2 flex flex-col gap-1.5">
            {summary.promotionPlan!.map((p, i) => (
              <div key={i} className="flex items-start gap-2 py-1 border-b border-slate-50 last:border-0">
                <span className="text-[11px] font-bold text-court-600 shrink-0 mt-0.5">{p.channel}</span>
                <span className="text-[12px] text-slate-700 flex-1">{p.action}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{p.timeline}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(summary.launchChecklist?.length ?? 0) > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
          <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Launch Checklist</span>
          <div className="mt-2 flex flex-col gap-1">
            {summary.launchChecklist!.map((c, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
                <span className={[
                  "text-[10px] font-bold px-1.5 py-0.5 rounded",
                  c.priority === "High" ? "bg-red-100 text-red-700"
                    : c.priority === "Medium" ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-500",
                ].join(" ")}>{c.priority}</span>
                <span className="text-[12px] text-slate-700 flex-1">{c.task}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{c.when}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
