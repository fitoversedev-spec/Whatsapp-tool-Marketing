"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  FieldHeader,
  StickyFooter,
  apiFetch,
  ApiError,
  useOnline,
} from "@/components/scout/mobile";
import { SectionLabel } from "@/components/scout/patterns";
import { Button } from "@/components/scout/ui";
import type { CostEstimateData } from "@/components/scout/analysis/CostEstimate";
import type { PlaceInsightData } from "@/components/scout/analysis/PlaceInsightCard";
import type { AreaSummaryData } from "@/components/scout/analysis/AreaSummary";

interface AnalysisState {
  id: string;
  status: string;
  totalPlaces: number;
  completedPlaces: number;
  failedPlaces: number;
  areaSummary: AreaSummaryData | null;
  insights: PlaceInsightData[];
  error: string | null;
}

const POLL_MS = 2_500;
const POLL_LIMIT = 180;

const saturationTone: Record<string, string> = {
  Low: "text-turf-600 bg-turf-100",
  Moderate: "text-blue-700 bg-blue-100",
  High: "text-red-700 bg-red-100",
  Oversaturated: "text-red-700 bg-red-100",
};

export function AnalysisScreen({ scanId }: { scanId: string }) {
  const router = useRouter();
  const online = useOnline();

  const [estimate, setEstimate] = useState<CostEstimateData | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloneAvailable, setCloneAvailable] = useState(false);
  const pollingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [estRes, analysisRes] = await Promise.all([
          apiFetch<{ estimate: CostEstimateData }>(`/api/scout/scans/${scanId}/analysis/estimate`),
          apiFetch<{
            analysis?: AnalysisState;
            existingAnalysis?: { id: string };
          }>(`/api/scout/scans/${scanId}/analysis`),
        ]);

        if (!cancelled) {
          setEstimate(estRes.data.estimate);
          if (analysisRes.data.analysis) {
            setAnalysis(analysisRes.data.analysis);
            const s = analysisRes.data.analysis.status;
            if (s === "running" || s === "pending") {
              startPolling(analysisRes.data.analysis.id);
            }
          } else if (analysisRes.data.existingAnalysis) {
            setCloneAvailable(true);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load analysis data.");
      } finally {
        if (!cancelled) setEstimateLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const poll = useCallback(async (analysisId: string) => {
    for (let i = 0; i < POLL_LIMIT; i++) {
      if (!pollingRef.current) return;
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const { data } = await apiFetch<{ analysis?: AnalysisState }>(
          `/api/scout/scans/${scanId}/analysis`,
        );
        if (!data.analysis) continue;
        setAnalysis(data.analysis);
        if (data.analysis.status !== "running" && data.analysis.status !== "pending") {
          pollingRef.current = false;
          return;
        }
      } catch {
        /* retry */
      }
    }
    pollingRef.current = false;
  }, [scanId]);

  const startPolling = useCallback((id: string) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    void poll(id);
  }, [poll]);

  useEffect(() => () => { pollingRef.current = false; }, []);

  const startAnalysis = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const { data } = await apiFetch<{ analysisId?: string; estimate?: CostEstimateData; error?: string }>(
        `/api/scout/scans/${scanId}/analysis`,
        { method: "POST", timeoutMs: 40_000 },
      );
      if (!data.analysisId) {
        setError(data.error ?? "Could not start analysis.");
        return;
      }
      setAnalysis({
        id: data.analysisId,
        status: "running",
        totalPlaces: data.estimate?.placeCount ?? 0,
        completedPlaces: 0,
        failedPlaces: 0,
        areaSummary: null,
        insights: [],
        error: null,
      });
      startPolling(data.analysisId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The analysis request failed.");
    } finally {
      setStarting(false);
    }
  }, [scanId, startPolling]);

  const cloneAnalysis = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const { data } = await apiFetch<{ analysisId?: string; error?: string }>(
        `/api/scout/scans/${scanId}/analysis/clone`,
        { method: "POST" },
      );
      if (!data.analysisId) {
        setError(data.error ?? "Could not clone analysis.");
        return;
      }
      setCloneAvailable(false);
      const refetch = await apiFetch<{ analysis?: AnalysisState }>(
        `/api/scout/scans/${scanId}/analysis`,
      );
      if (refetch.data.analysis) setAnalysis(refetch.data.analysis);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The clone request failed.");
    } finally {
      setStarting(false);
    }
  }, [scanId]);

  const isDone = analysis && (analysis.status === "completed" || analysis.status === "partial" || analysis.status === "failed");
  const isRunning = analysis && (analysis.status === "running" || analysis.status === "pending");
  const pct = analysis && analysis.totalPlaces > 0
    ? Math.round(((analysis.completedPlaces + analysis.failedPlaces) / analysis.totalPlaces) * 100)
    : 0;

  return (
    <div className="mScreen">
      <FieldHeader
        statusLeft={online ? "Field mode" : "Offline"}
        statusRight="AI Analysis"
        backHref={`/scout/m/scan/${scanId}`}
        backLabel="Back to results"
        title="AI Analysis"
        subtitle={
          analysis
            ? `${analysis.completedPlaces} of ${analysis.totalPlaces} places done`
            : estimate
              ? `${estimate.placeCount} places`
              : undefined
        }
        activeKey="analysis"
        navContext={{ scanId }}
      />

      <div className="mScroll ss-scroll pt-4 px-[var(--m-pad-x)] pb-5 flex flex-col gap-4 mIn">
        {error ? (
          <p className="bg-[var(--surface-card)] border border-track-500 rounded-[var(--radius-12)] py-[13px] px-3.5 text-[length:var(--text-12-5)] leading-[1.55] text-[var(--ink)]" role="alert">
            {error}
          </p>
        ) : null}

        {/* ---------------------------------------- cost estimate */}
        {!analysis && !cloneAvailable && estimate && !estimateLoading ? (
          <div className="bg-[var(--surface-card)] border border-amber-200 rounded-[var(--radius-16)] p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-600 flex-none" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span className="font-semibold text-[length:var(--text-13)] text-amber-800">AI Analysis Cost</span>
            </div>
            <p className="m-0 text-[length:var(--text-12-5)] text-amber-700 leading-[1.6]">
              <span className="font-semibold">{estimate.placeCount} places</span> will be analysed using
              Claude AI web search.
            </p>
            <p className="m-0 text-[length:var(--text-11-5)] text-amber-600">
              Estimated cost: ~₹{estimate.estimatedCostInr.toFixed(2)}
            </p>
          </div>
        ) : null}

        {/* ---------------------------------------- clone available */}
        {!analysis && cloneAvailable ? (
          <div className="bg-[var(--surface-card)] border border-court-200 rounded-[var(--radius-16)] p-4 flex flex-col gap-3">
            <p className="m-0 text-[length:var(--text-13)] text-court-800 leading-[1.6]">
              Another team member has already analysed this area. You can clone their results and edit them.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void cloneAnalysis()} disabled={starting || !online}>
                {starting ? "Cloning…" : "Clone for your edits"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void startAnalysis()} disabled={starting || !online}>
                Run fresh
              </Button>
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------- loading */}
        {estimateLoading && !analysis ? (
          <div className="flex items-center gap-2 text-[length:var(--text-13)] text-[var(--m-muted)] py-4">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading…
          </div>
        ) : null}

        {/* ---------------------------------------- progress */}
        {analysis ? (
          <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-16)] p-4">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <svg className="animate-spin h-4 w-4 text-court-500" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : null}
                <span className="text-[length:var(--text-13)] font-semibold text-[var(--ink)]">
                  {analysis.status === "completed"
                    ? "Analysis complete"
                    : analysis.status === "failed"
                      ? "Analysis failed"
                      : analysis.status === "partial"
                        ? "Partial results"
                        : "Analysing places…"}
                </span>
              </div>
              <span className="text-[length:var(--text-11-5)] text-[var(--m-muted-on-white)]">
                {analysis.completedPlaces}/{analysis.totalPlaces}
                {analysis.failedPlaces > 0 ? ` · ${analysis.failedPlaces} failed` : ""}
              </span>
            </div>

            <div
              className="h-1.5 rounded-full bg-slate-200 overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label="Analysis progress"
            >
              <span
                className={[
                  "block h-full rounded-full transition-all duration-300",
                  analysis.failedPlaces > 0 && analysis.completedPlaces === 0
                    ? "bg-red-400"
                    : analysis.status === "completed"
                      ? "bg-court-500"
                      : "bg-court-400",
                ].join(" ")}
                style={{ width: `${pct}%` }}
              />
            </div>

            {isRunning ? (
              <p className="m-0 mt-2 text-[length:var(--text-11-5)] text-[var(--m-muted-on-white)]">
                Places are analysed in batches. This screen updates live — you can keep working.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ---------------------------------------- area summary */}
        {analysis?.areaSummary ? (
          <>
            <SectionLabel as="h2">Area summary</SectionLabel>

            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[var(--m-muted-on-white)]">Market Saturation</span>
                <span className={`text-[length:var(--text-11)] font-bold rounded-full px-2.5 py-0.5 ${saturationTone[analysis.areaSummary.marketSaturation.level] ?? "text-slate-600 bg-slate-100"}`}>
                  {analysis.areaSummary.marketSaturation.level}
                </span>
              </div>
              <p className="m-0 text-[length:var(--text-12-5)] text-[var(--m-muted-on-white)] leading-[1.6]">
                {analysis.areaSummary.marketSaturation.explanation}
              </p>
            </div>

            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[var(--m-muted-on-white)]">Opportunity Score</span>
                <span className="text-[length:var(--text-15-5)] font-bold text-[var(--ink)]">{analysis.areaSummary.opportunityScore.score}/10</span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
                <div
                  className={[
                    "h-full rounded-full transition-all duration-500",
                    analysis.areaSummary.opportunityScore.score >= 7
                      ? "bg-court-500"
                      : analysis.areaSummary.opportunityScore.score >= 4
                        ? "bg-amber-400"
                        : "bg-red-400",
                  ].join(" ")}
                  style={{ width: `${Math.min(analysis.areaSummary.opportunityScore.score * 10, 100)}%` }}
                />
              </div>
              <p className="m-0 text-[length:var(--text-12-5)] text-[var(--m-muted-on-white)] leading-[1.6]">
                {analysis.areaSummary.opportunityScore.reasoning}
              </p>
            </div>

            {analysis.areaSummary.risks.length > 0 ? (
              <div className="bg-[var(--surface-card)] border border-red-200 rounded-lg p-3.5">
                <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-red-700">Identified Risks</span>
                <ul className="m-0 mt-2 pl-4 flex flex-col gap-1">
                  {analysis.areaSummary.risks.map((risk, i) => (
                    <li key={i} className="text-[length:var(--text-12-5)] text-red-700 leading-[1.6]">{risk}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="bg-[var(--surface-card)] border border-court-200 rounded-lg p-3.5">
              <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-court-700">Recommendation</span>
              <p className="m-0 mt-2 text-[length:var(--text-13)] text-court-900 leading-[1.65] font-medium">
                {analysis.areaSummary.executiveRecommendation}
              </p>
            </div>

            {analysis.areaSummary.oneLineStrategy ? (
              <div className="bg-slate-900 rounded-lg p-3.5">
                <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-slate-400">The Pitch</span>
                <p className="m-0 mt-1.5 text-[length:var(--text-13)] text-white leading-[1.6] italic">
                  &ldquo;{analysis.areaSummary.oneLineStrategy}&rdquo;
                </p>
              </div>
            ) : null}

            {(analysis.areaSummary.opportunities?.length ?? 0) > 0 ? (
              <div className="bg-[var(--surface-card)] border border-blue-100 rounded-lg p-3.5">
                <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-blue-700">Market Opportunities</span>
                <div className="mt-2 flex flex-col gap-2">
                  {analysis.areaSummary.opportunities!.map((o: { title: string; detail: string }, i: number) => (
                    <div key={i}>
                      <span className="text-[length:var(--text-12-5)] font-semibold text-blue-900">{o.title}</span>
                      <p className="m-0 mt-0.5 text-[length:var(--text-12)] text-blue-800 leading-[1.5]">{o.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(analysis.areaSummary.competitorLearnings?.length ?? 0) > 0 ? (
              <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-3.5">
                <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[var(--m-muted-on-white)]">Competitor Learnings</span>
                <div className="mt-2 flex flex-col gap-2">
                  {analysis.areaSummary.competitorLearnings!.map((l: { complaint: string; seenAt: string; ourRule: string }, i: number) => (
                    <div key={i} className="border-l-2 border-amber-400 pl-3 py-1">
                      <p className="m-0 text-[length:var(--text-12)] text-[var(--ink)]">{l.complaint} <span className="text-[var(--m-muted)]">— {l.seenAt}</span></p>
                      <p className="m-0 mt-0.5 text-[length:var(--text-12)] font-semibold text-court-700">{l.ourRule}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(analysis.areaSummary.promotionPlan?.length ?? 0) > 0 ? (
              <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-3.5">
                <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[var(--m-muted-on-white)]">Promotion Plan</span>
                <div className="mt-2 flex flex-col gap-1.5">
                  {analysis.areaSummary.promotionPlan!.map((p: { channel: string; action: string; timeline: string }, i: number) => (
                    <div key={i} className="flex items-start gap-2 py-1 border-b border-slate-50 last:border-0">
                      <span className="text-[length:var(--text-11)] font-bold text-court-600 shrink-0">{p.channel}</span>
                      <span className="text-[length:var(--text-12)] text-[var(--ink)] flex-1">{p.action}</span>
                      <span className="text-[length:var(--text-11)] text-[var(--m-muted)] shrink-0">{p.timeline}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(analysis.areaSummary.launchChecklist?.length ?? 0) > 0 ? (
              <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-3.5">
                <span className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[var(--m-muted-on-white)]">Launch Checklist</span>
                <div className="mt-2 flex flex-col gap-1">
                  {analysis.areaSummary.launchChecklist!.map((c: { task: string; priority: string; when: string }, i: number) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
                      <span className={[
                        "text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0",
                        c.priority === "High" ? "bg-red-100 text-red-700"
                          : c.priority === "Medium" ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-500",
                      ].join(" ")}>{c.priority}</span>
                      <span className="text-[length:var(--text-12)] text-[var(--ink)] flex-1">{c.task}</span>
                      <span className="text-[length:var(--text-11)] text-[var(--m-muted)] shrink-0">{c.when}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {/* ---------------------------------------- pricing input */}
        {isDone && analysis && analysis.insights.length > 0 ? (
          <>
            <SectionLabel as="h2">Competitor pricing (optional)</SectionLabel>
            <p className="m-0 text-[length:var(--text-12)] text-[var(--m-muted-on-white)] leading-[1.5] -mt-1">
              Enter pricing you know for each competitor. This appears in the report.
            </p>
            <PricingInputs scanId={scanId} insights={analysis.insights} />
          </>
        ) : null}

        {/* ---------------------------------------- place insights */}
        {analysis && analysis.insights.length > 0 ? (
          <>
            <SectionLabel as="h2">Place insights</SectionLabel>
            <div className="flex flex-col gap-2.5">
              {analysis.insights.map((insight) => (
                <MobileInsightCard key={insight.insightId} insight={insight} />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <StickyFooter
        note={
          isRunning
            ? "Analysis is running — you can come back later."
            : isDone
              ? "Head to Report to include these insights."
              : !online
                ? "No network — analysis needs a connection."
                : undefined
        }
      >
        {!analysis && !cloneAvailable && !estimateLoading ? (
          <Button
            block
            size="lg"
            disabled={starting || !online}
            onClick={() => void startAnalysis()}
          >
            {starting ? "Starting…" : `Analyse ${estimate?.placeCount ?? 0} places`}
          </Button>
        ) : isDone ? (
          <Button
            block
            size="lg"
            onClick={() => router.push(`/scout/m/report/${scanId}`)}
          >
            Continue to report
          </Button>
        ) : null}
      </StickyFooter>
    </div>
  );
}

function MobileInsightCard({ insight }: { insight: PlaceInsightData }) {
  if (insight.status === "failed") {
    return (
      <div className="bg-[var(--surface-card)] border border-red-200 rounded-lg p-3.5">
        <div className="font-semibold text-[length:var(--text-13)] text-red-800">{insight.placeName}</div>
        <p className="m-0 mt-1 text-[length:var(--text-12)] text-red-600">{insight.error ?? "Analysis failed."}</p>
      </div>
    );
  }

  if (insight.status === "pending") {
    return (
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-3.5 opacity-60">
        <div className="font-semibold text-[length:var(--text-13)] text-[var(--m-muted)]">{insight.placeName}</div>
        <p className="m-0 mt-1 text-[length:var(--text-12)] text-[var(--m-muted)]">Waiting…</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-[length:var(--text-13)] text-[var(--ink)]">{insight.placeName}</span>
        {insight.suitability?.confidence ? (
          <ConfBadge level={insight.suitability.confidence} />
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Row label="Established" value={insight.establishedDate?.value ?? null} confidence={insight.establishedDate?.confidence} />
        <Row label="Popular times" value={insight.popularTimes?.value ?? null} confidence={insight.popularTimes?.confidence} />
        <Row
          label="Google Reviews"
          value={insight.sentiment?.googleReviews ? `${insight.sentiment.googleReviews.tone} — ${insight.sentiment.googleReviews.summary}` : null}
          confidence={insight.sentiment?.googleReviews?.confidence}
        />
        <Row
          label="Social media"
          value={insight.sentiment?.socialMedia?.summary ?? null}
          confidence={insight.sentiment?.socialMedia?.confidence}
        />
      </div>

      {(insight.sentiment?.whatWorks?.length ?? 0) > 0 && (
        <div className="mt-2 pt-2 border-t border-[var(--border-default)]">
          <div className="text-[length:var(--text-11)] font-semibold text-green-700 uppercase tracking-wide mb-1">What works well</div>
          <ul className="m-0 pl-4 flex flex-col gap-0.5">
            {insight.sentiment!.whatWorks!.map((item, i) => (
              <li key={i} className="text-[length:var(--text-11-5)] text-green-800 leading-[1.5]">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {(insight.sentiment?.whatDoesnt?.length ?? 0) > 0 && (
        <div className="mt-2 pt-2 border-t border-[var(--border-default)]">
          <div className="text-[length:var(--text-11)] font-semibold text-red-700 uppercase tracking-wide mb-1">What doesn&apos;t work</div>
          <ul className="m-0 pl-4 flex flex-col gap-0.5">
            {insight.sentiment!.whatDoesnt!.map((item, i) => (
              <li key={i} className="text-[length:var(--text-11-5)] text-red-700 leading-[1.5]">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {insight.suitability ? (
        <div className="mt-2 pt-2 border-t border-[var(--border-default)]">
          <div className="text-[length:var(--text-11)] font-semibold text-[var(--m-muted-on-white)] mb-1">Suitability</div>
          <p className="m-0 text-[length:var(--text-12-5)] text-[var(--ink)] leading-[1.6]">{insight.suitability.recommendation}</p>
          {insight.suitability.reasoning ? (
            <p className="m-0 mt-1 text-[length:var(--text-11-5)] text-[var(--m-muted-on-white)] leading-[1.5]">{insight.suitability.reasoning}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConfBadge({ level }: { level: string }) {
  const cls =
    level === "High"
      ? "text-turf-700 bg-turf-100"
      : level === "Medium"
        ? "text-blue-700 bg-blue-100"
        : "text-slate-600 bg-slate-100";
  return (
    <span className={`text-[length:var(--text-10)] font-bold rounded-full px-2 py-0.5 ${cls}`}>
      {level}
    </span>
  );
}

function Row({ label, value, confidence }: { label: string; value: string | null; confidence?: string }) {
  const display = value ?? "Not Available";
  const isNA = display === "Not Available" || display === "Insufficient data";
  return (
    <div className="flex justify-between items-start py-1 gap-2">
      <span className="text-[length:var(--text-11)] font-semibold text-[var(--m-muted-on-white)] shrink-0">{label}</span>
      <div className="flex items-center gap-1 text-right min-w-0">
        <span className={[
          "text-[length:var(--text-11-5)] break-words min-w-0",
          isNA ? "text-[var(--m-muted)] italic" : "text-[var(--ink)]",
        ].join(" ")}>{display}</span>
        {confidence ? <ConfBadge level={confidence} /> : null}
      </div>
    </div>
  );
}

function PricingInputs({
  scanId,
  insights,
}: {
  scanId: string;
  insights: PlaceInsightData[];
}) {
  const completed = insights.filter((i) => i.status === "completed");
  const [pricing, setPricing] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const i of insights) {
      if (i.editedFields?.pricing) initial[i.insightId] = i.editedFields.pricing;
    }
    return initial;
  });
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const timerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleChange = useCallback(
    (insightId: string, value: string) => {
      setPricing((prev) => ({ ...prev, [insightId]: value }));
      setSaved((prev) => ({ ...prev, [insightId]: false }));

      if (timerRef.current[insightId]) clearTimeout(timerRef.current[insightId]);
      timerRef.current[insightId] = setTimeout(async () => {
        setSaving((prev) => ({ ...prev, [insightId]: true }));
        try {
          await apiFetch(
            `/api/scout/scans/${scanId}/analysis/insights/${insightId}`,
            {
              method: "PATCH",
              body: { editedFields: { pricing: value || null } },
            },
          );
          setSaved((prev) => ({ ...prev, [insightId]: true }));
        } catch {
          // silent — the draft auto-save is best-effort
        } finally {
          setSaving((prev) => ({ ...prev, [insightId]: false }));
        }
      }, 800);
    },
    [scanId],
  );

  if (completed.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {completed.map((insight) => (
        <div
          key={insight.insightId}
          className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-3"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[length:var(--text-12)] font-semibold text-[var(--ink)]">
              {insight.placeName}
            </span>
            {saving[insight.insightId] ? (
              <span className="text-[length:var(--text-10)] text-[var(--m-muted)]">Saving…</span>
            ) : saved[insight.insightId] ? (
              <span className="text-[length:var(--text-10)] text-court-600">Saved</span>
            ) : null}
          </div>
          <input
            type="text"
            className="w-full box-border text-[length:var(--text-12-5)] text-[var(--ink)] bg-slate-50 border border-slate-200 rounded-md px-3 py-2 outline-none focus:border-court-500 focus:ring-1 focus:ring-court-500"
            placeholder="e.g. ₹500-800/hr for 5-a-side"
            value={pricing[insight.insightId] ?? ""}
            onChange={(e) => handleChange(insight.insightId, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
