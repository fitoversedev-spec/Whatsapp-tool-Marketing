"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StepBar } from "@/components/scout/steps/StepBar";
import { SuggestionsStep } from "@/components/scout/steps/SuggestionsStep";
import { ReportStep, type GeneratedReport } from "@/components/scout/steps/ReportStep";
import type { ReportBlockState } from "@/lib/scout/reports/blocks";

const STEP_LABELS = ["Results", "Suggestions", "Report"] as const;
const POLL_MS = 1_000;
const POLL_LIMIT = 60;

export interface ScanWizardProps {
  scanId: string;
  preparedBy: string;
  initialBlocks: ReportBlockState;
  initialBlockOrder: string[] | null;
  initialSectionText: Record<string, string> | null;
  initialNotes: string;
  initialSuggestions: string;
  initialPolished: string;
  initialReport: GeneratedReport | null;
  onBack: () => void;
}

export function ScanWizard({
  scanId,
  preparedBy,
  initialBlocks,
  initialBlockOrder,
  initialSectionText,
  initialNotes,
  initialSuggestions,
  initialPolished,
  initialReport,
  onBack,
}: ScanWizardProps) {
  const [step, setStep] = useState(0);
  const [suggestionsText, setSuggestionsText] = useState(initialSuggestions);
  const [polishedSuggestions, setPolishedSuggestions] = useState(initialPolished);
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  const [report, setReport] = useState<GeneratedReport | null>(initialReport);
  const [generating, setGenerating] = useState(false);
  const autoGenTriggered = useRef(false);

  const generateReport = useCallback(async (opts: {
    suggestionsText?: string;
    polishedSuggestions?: string;
  } = {}) => {
    setGenerating(true);
    try {
      await fetch(`/api/scout/scans/${scanId}/report`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includedBlocks: initialBlocks,
          suggestionsText: opts.suggestionsText ?? "",
          polishedSuggestions: opts.polishedSuggestions ?? "",
        }),
      });

      const res = await fetch(`/api/scout/scans/${scanId}/report/generate`, { method: "POST" });
      const json = (await res.json()) as { report?: GeneratedReport; error?: string };
      if (!res.ok || !json.report) {
        setGenerating(false);
        return;
      }
      setReport(json.report);

      for (let attempt = 0; attempt < POLL_LIMIT; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const poll = await fetch(`/api/scout/scans/${scanId}/report/generate`);
        if (!poll.ok) continue;
        const state = (await poll.json()) as { report?: GeneratedReport | null };
        if (!state.report) continue;
        setReport(state.report);
        if (state.report.status !== "generating") break;
      }
    } catch { /* swallow */ }
    setGenerating(false);
  }, [scanId, initialBlocks]);

  useEffect(() => {
    if (!report && !generating && !autoGenTriggered.current) {
      autoGenTriggered.current = true;
      void generateReport();
    }
  }, [report, generating, generateReport]);

  const goToStep = (index: number) => {
    if (index >= 0 && index <= 2) setStep(index);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden ssIn">
      <div className="bg-white border-b border-slate-200 px-4 py-2">
        <StepBar steps={STEP_LABELS} current={step} onStep={goToStep} />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-8 bg-white ss-scroll">
        <div className={step >= 1 ? "max-w-5xl mx-auto" : "max-w-lg mx-auto"}>
          {step === 0 ? (
            <div className="flex flex-col gap-4">
              <h2 className="m-0 text-base font-semibold">Scan results reviewed</h2>
              <p className="m-0 text-sm text-slate-600 leading-[1.6]">
                You&apos;ve finished reviewing and removing places from your scan results.
                Continue to add your suggestions.
              </p>
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  className="text-sm text-court-600 font-semibold hover:text-court-700"
                  onClick={onBack}
                >
                  Back to results
                </button>
                <button
                  type="button"
                  className="flex-1 bg-court-500 text-white border-0 rounded-full py-2.5 px-5 text-sm font-semibold cursor-pointer hover:brightness-[0.92] transition-all"
                  onClick={() => setStep(1)}
                >
                  Next: Your Suggestions
                </button>
              </div>
            </div>
          ) : step === 1 ? (
            <SuggestionsStep
              scanId={scanId}
              initialSuggestions={suggestionsText}
              initialPolished={polishedSuggestions}
              report={report}
              generating={generating}
              onRegenerateWithSuggestions={(sug, pol) => void generateReport({ suggestionsText: sug, polishedSuggestions: pol })}
              onNext={(sug, pol) => {
                setSuggestionsText(sug);
                setPolishedSuggestions(pol);
                setStep(2);
              }}
              onBack={() => setStep(0)}
            />
          ) : (
            <ReportStep
              scanId={scanId}
              analysisId={analysisId}
              initialBlocks={initialBlocks}
              initialBlockOrder={initialBlockOrder}
              initialSectionText={initialSectionText}
              initialNotes={initialNotes}
              suggestionsText={suggestionsText}
              polishedSuggestions={polishedSuggestions}
              preparedBy={preparedBy}
              initialReport={report}
              onBack={() => setStep(1)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
