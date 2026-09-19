"use client";

import { useState } from "react";
import { StepBar } from "@/components/scout/steps/StepBar";
import { SuggestionsStep } from "@/components/scout/steps/SuggestionsStep";
import { AnalysisStep } from "@/components/scout/steps/AnalysisStep";
import { ReportStep, type GeneratedReport } from "@/components/scout/steps/ReportStep";
import type { ReportBlockState } from "@/lib/scout/reports/blocks";

const STEP_LABELS = ["Results", "Suggestions", "AI Analysis", "Report"] as const;

export interface ScanWizardProps {
  scanId: string;
  preparedBy: string;
  initialBlocks: ReportBlockState;
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

  const goToStep = (index: number) => {
    if (index >= 0 && index <= 3) setStep(index);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden ssIn">
      <div className="bg-white border-b border-slate-200 px-4 py-2">
        <StepBar steps={STEP_LABELS} current={step} onStep={goToStep} />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-8 bg-white ss-scroll">
        <div className="max-w-lg mx-auto">
          {step === 0 ? (
            <div className="flex flex-col gap-4">
              <h2 className="m-0 text-base font-semibold">Scan results reviewed</h2>
              <p className="m-0 text-[13px] text-slate-600 leading-[1.6]">
                You&apos;ve finished reviewing and removing places from your scan results.
                Continue to add your suggestions and optionally run AI analysis.
              </p>
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  className="text-[13px] text-court-600 font-semibold hover:text-court-700"
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
              onNext={(sug, pol) => {
                setSuggestionsText(sug);
                setPolishedSuggestions(pol);
                setStep(2);
              }}
              onBack={() => setStep(0)}
            />
          ) : step === 2 ? (
            <AnalysisStep
              scanId={scanId}
              onNext={(aid) => {
                setAnalysisId(aid);
                setStep(3);
              }}
              onBack={() => setStep(1)}
            />
          ) : (
            <ReportStep
              scanId={scanId}
              analysisId={analysisId}
              initialBlocks={initialBlocks}
              initialNotes={initialNotes}
              suggestionsText={suggestionsText}
              polishedSuggestions={polishedSuggestions}
              preparedBy={preparedBy}
              initialReport={initialReport}
              onBack={() => setStep(2)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
