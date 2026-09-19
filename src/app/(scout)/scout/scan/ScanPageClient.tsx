"use client";

import { useCallback, useState } from "react";
import type { ScanScreenData, TaxonomyDto } from "@/lib/scout/scans/dto";
import type { ReportBlockState } from "@/lib/scout/reports/blocks";
import type { GeneratedReport } from "@/components/scout/steps/ReportStep";
import { ScanScreen } from "./ScanScreen";
import { ScanWizard } from "./ScanWizard";

export interface ScanPageClientProps {
  taxonomy: TaxonomyDto;
  initial: ScanScreenData;
  googleKeyMissing: boolean;
  preparedBy: string;
  initialBlocks: ReportBlockState;
  initialNotes: string;
  initialSuggestions: string;
  initialPolished: string;
  initialReport: GeneratedReport | null;
}

export function ScanPageClient({
  taxonomy,
  initial,
  googleKeyMissing,
  preparedBy,
  initialBlocks,
  initialNotes,
  initialSuggestions,
  initialPolished,
  initialReport,
}: ScanPageClientProps) {
  const [showWizard, setShowWizard] = useState(false);

  const handleContinue = useCallback(() => setShowWizard(true), []);
  const handleBack = useCallback(() => setShowWizard(false), []);

  if (showWizard) {
    return (
      <ScanWizard
        scanId={initial.scanId}
        preparedBy={preparedBy}
        initialBlocks={initialBlocks}
        initialNotes={initialNotes}
        initialSuggestions={initialSuggestions}
        initialPolished={initialPolished}
        initialReport={initialReport}
        onBack={handleBack}
      />
    );
  }

  return (
    <ScanScreen
      taxonomy={taxonomy}
      initial={initial}
      googleKeyMissing={googleKeyMissing}
      onContinue={handleContinue}
    />
  );
}
