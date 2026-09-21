"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { CostEstimate, type CostEstimateData } from "@/components/scout/analysis/CostEstimate";
import { AnalysisProgress } from "@/components/scout/analysis/AnalysisProgress";
import { PlaceInsightCard, type PlaceInsightData } from "@/components/scout/analysis/PlaceInsightCard";
import { AreaSummary, type AreaSummaryData } from "@/components/scout/analysis/AreaSummary";

export interface AnalysisStepProps {
  scanId: string;
  onNext: (analysisId: string | null) => void;
  onBack: () => void;
}

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

const POLL_MS = 2_000;
const POLL_LIMIT = 180;

export function AnalysisStep({ scanId, onNext, onBack }: AnalysisStepProps) {
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
          fetch(`/api/scout/scans/${scanId}/analysis/estimate`),
          fetch(`/api/scout/scans/${scanId}/analysis`),
        ]);

        if (!cancelled && estRes.ok) {
          const data = await estRes.json();
          setEstimate((data.estimate ?? data) as CostEstimateData);
        }

        if (!cancelled && analysisRes.ok) {
          const data = (await analysisRes.json()) as {
            analysis?: AnalysisState;
            existingAnalysis?: { id: string };
          };
          if (data.analysis) {
            setAnalysis(data.analysis);
            if (data.analysis.status === "running" || data.analysis.status === "pending") {
              startPolling(data.analysis.id);
            }
          } else if (data.existingAnalysis) {
            setCloneAvailable(true);
          }
        }
      } catch {
        if (!cancelled) setError("Could not load analysis data.");
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
        const res = await fetch(`/api/scout/scans/${scanId}/analysis`);
        if (!res.ok) continue;
        const data = (await res.json()) as { analysis?: AnalysisState };
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
      const res = await fetch(`/api/scout/scans/${scanId}/analysis`, {
        method: "POST",
      });
      const data = (await res.json()) as { analysisId?: string; estimate?: CostEstimateData; error?: string };
      if (!res.ok || !data.analysisId) {
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
    } catch {
      setError("The analysis request failed.");
    } finally {
      setStarting(false);
    }
  }, [scanId, startPolling]);

  const cloneAnalysis = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/scout/scans/${scanId}/analysis/clone`, {
        method: "POST",
      });
      const data = (await res.json()) as { analysisId?: string; error?: string };
      if (!res.ok || !data.analysisId) {
        setError(data.error ?? "Could not clone analysis.");
        return;
      }
      setCloneAvailable(false);
      const refetch = await fetch(`/api/scout/scans/${scanId}/analysis`);
      if (refetch.ok) {
        const refetchData = (await refetch.json()) as { analysis?: AnalysisState };
        if (refetchData.analysis) setAnalysis(refetchData.analysis);
      }
    } catch {
      setError("The clone request failed.");
    } finally {
      setStarting(false);
    }
  }, [scanId]);

  const isDone = analysis && (analysis.status === "completed" || analysis.status === "partial" || analysis.status === "failed");
  const hasResults = analysis && analysis.insights.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="m-0 text-base font-semibold">AI Analysis</h2>
        <p className="m-0 mt-1 text-[12.5px] leading-[1.6] text-slate-500">
          Optional — Claude AI searches the web for establishment dates, popular times, review
          sentiment, and suitability insights for each competitor.
        </p>
      </div>

      {error ? <StateBlock tone="error" title="Something went wrong" body={error} /> : null}

      {!analysis && !cloneAvailable && estimate && !estimateLoading ? (
        <>
          <CostEstimate estimate={estimate} />
          <Button block onClick={() => void startAnalysis()} disabled={starting}>
            {starting ? "Starting analysis…" : `Analyse ${estimate.placeCount} places`}
          </Button>
        </>
      ) : null}

      {!analysis && cloneAvailable ? (
        <div className="rounded-lg border border-court-200 bg-court-50 px-4 py-3.5">
          <p className="m-0 text-[13px] text-court-800 leading-[1.6] mb-3">
            Another team member has already analysed this area. You can clone their results and edit them.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void cloneAnalysis()} disabled={starting}>
              {starting ? "Cloning…" : "Clone for your edits"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void startAnalysis()} disabled={starting}>
              Run fresh analysis
            </Button>
          </div>
        </div>
      ) : null}

      {estimateLoading && !analysis ? (
        <div className="flex items-center gap-2 text-[13px] text-slate-500 py-4">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading estimate…
        </div>
      ) : null}

      {analysis ? (
        <>
          <AnalysisProgress
            total={analysis.totalPlaces}
            completed={analysis.completedPlaces}
            failed={analysis.failedPlaces}
            status={analysis.status}
          />

          {analysis.areaSummary ? (
            <>
              <SectionLabel weight={700}>Area Summary</SectionLabel>
              <AreaSummary summary={analysis.areaSummary} />
            </>
          ) : null}

          {hasResults ? (
            <>
              <SectionLabel weight={700}>Place Insights</SectionLabel>
              <div className="flex flex-col gap-2.5">
                {analysis.insights.map((insight) => (
                  <PlaceInsightCard key={insight.insightId} insight={insight} />
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      <div className="flex gap-3 mt-2">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button
          className="flex-1"
          variant={isDone || !analysis ? "primary" : "ghost"}
          onClick={() => onNext(analysis?.id ?? null)}
        >
          {!analysis ? "Skip — go to report" : isDone ? "Next: Generate Report" : "Skip analysis"}
        </Button>
      </div>
    </div>
  );
}
