"use client";

import { Badge } from "@/components/scout/ui";

export interface PlaceInsightData {
  insightId: string;
  placeName: string;
  status: string;
  establishedDate: { value: string | null; confidence: string } | null;
  popularTimes: { value: string | null; confidence: string } | null;
  sentiment: {
    googleReviews: { summary: string; tone: string; confidence: string } | null;
    socialMedia: { summary: string | null; confidence: string } | null;
    whatWorks?: string[];
    whatDoesnt?: string[];
  } | null;
  suitability: { recommendation: string; confidence: string; reasoning: string } | null;
  editedFields?: { pricing?: string | null } | null;
  error: string | null;
}

export interface PlaceInsightCardProps {
  insight: PlaceInsightData;
  className?: string;
}

function ConfidenceBadge({ level }: { level: string }) {
  const tone = level === "High" ? "green" : level === "Medium" ? "blue" : "neutral";
  return <Badge tone={tone}>{level}</Badge>;
}

function InsightRow({ label, value, confidence }: { label: string; value: string | null; confidence?: string }) {
  const display = value ?? "Not Available";
  const isNA = display === "Not Available" || display === "Insufficient data";
  return (
    <div className="flex justify-between items-start py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-[12px] font-semibold text-slate-500 shrink-0 mr-3">{label}</span>
      <div className="flex items-center gap-1.5 text-right">
        <span className={["text-[12.5px]", isNA ? "text-slate-400 italic" : "text-slate-700"].join(" ")}>{display}</span>
        {confidence ? <ConfidenceBadge level={confidence} /> : null}
      </div>
    </div>
  );
}

export function PlaceInsightCard({ insight, className }: PlaceInsightCardProps) {
  if (insight.status === "failed") {
    return (
      <div className={["rounded-lg border border-red-200 bg-red-50 px-4 py-3", className].filter(Boolean).join(" ")}>
        <div className="font-semibold text-[13px] text-red-800">{insight.placeName}</div>
        <p className="m-0 mt-1 text-[12px] text-red-600">{insight.error ?? "Analysis failed for this place."}</p>
      </div>
    );
  }

  if (insight.status === "pending") {
    return (
      <div className={["rounded-lg border border-slate-200 bg-slate-50 px-4 py-3", className].filter(Boolean).join(" ")}>
        <div className="font-semibold text-[13px] text-slate-500">{insight.placeName}</div>
        <p className="m-0 mt-1 text-[12px] text-slate-400">Waiting to be analysed…</p>
      </div>
    );
  }

  return (
    <div className={["rounded-lg border border-slate-200 bg-white px-4 py-3", className].filter(Boolean).join(" ")}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-[13px] text-slate-800">{insight.placeName}</span>
        {insight.suitability?.confidence ? (
          <ConfidenceBadge level={insight.suitability.confidence} />
        ) : null}
      </div>

      <div className="flex flex-col">
        <InsightRow
          label="Established"
          value={insight.establishedDate?.value ?? null}
          confidence={insight.establishedDate?.confidence}
        />
        <InsightRow
          label="Popular times"
          value={insight.popularTimes?.value ?? null}
          confidence={insight.popularTimes?.confidence}
        />
        {insight.sentiment?.googleReviews ? (
          <InsightRow
            label="Google Reviews"
            value={`${insight.sentiment.googleReviews.tone} — ${insight.sentiment.googleReviews.summary}`}
            confidence={insight.sentiment.googleReviews.confidence}
          />
        ) : (
          <InsightRow label="Google Reviews" value={null} />
        )}
        {insight.sentiment?.socialMedia ? (
          <InsightRow
            label="Social media"
            value={insight.sentiment.socialMedia.summary}
            confidence={insight.sentiment.socialMedia.confidence}
          />
        ) : (
          <InsightRow label="Social media" value={null} />
        )}
      </div>

      {(insight.sentiment?.whatWorks?.length ?? 0) > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <div className="text-[11px] font-semibold text-green-700 uppercase tracking-wide mb-1">What works well</div>
          <ul className="m-0 pl-4 flex flex-col gap-0.5">
            {insight.sentiment!.whatWorks!.map((item, i) => (
              <li key={i} className="text-[12px] text-green-800 leading-[1.5]">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {(insight.sentiment?.whatDoesnt?.length ?? 0) > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <div className="text-[11px] font-semibold text-red-700 uppercase tracking-wide mb-1">What doesn&apos;t work</div>
          <ul className="m-0 pl-4 flex flex-col gap-0.5">
            {insight.sentiment!.whatDoesnt!.map((item, i) => (
              <li key={i} className="text-[12px] text-red-700 leading-[1.5]">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {insight.suitability ? (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <div className="text-[12px] font-semibold text-slate-500 mb-1">Suitability</div>
          <p className="m-0 text-[12.5px] text-slate-700 leading-[1.6]">{insight.suitability.recommendation}</p>
          {insight.suitability.reasoning ? (
            <p className="m-0 mt-1 text-[11.5px] text-slate-500 leading-[1.6]">{insight.suitability.reasoning}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
