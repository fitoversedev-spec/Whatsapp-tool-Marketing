"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/scout/ui";
import { SectionLabel } from "@/components/scout/patterns";
import type { GeneratedReport } from "./ReportStep";

export interface SuggestionsStepProps {
  scanId: string;
  initialSuggestions: string;
  initialPolished: string;
  report: GeneratedReport | null;
  generating: boolean;
  onRegenerateWithSuggestions: (suggestionsText: string, polishedSuggestions: string) => void;
  onNext: (suggestions: string, polished: string) => void;
  onBack: () => void;
}

const SAVE_DEBOUNCE_MS = 600;

export function SuggestionsStep({
  scanId,
  initialSuggestions,
  initialPolished,
  report,
  generating,
  onRegenerateWithSuggestions,
  onNext,
  onBack,
}: SuggestionsStepProps) {
  const [suggestionsText, setSuggestionsText] = useState(initialSuggestions);
  const [polishedSuggestions, setPolishedSuggestions] = useState(initialPolished);
  const [polishedText, setPolishedText] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const loadedRef = useRef(JSON.stringify({ suggestionsText: initialSuggestions, polishedSuggestions: initialPolished }));
  useEffect(() => {
    if (JSON.stringify({ suggestionsText, polishedSuggestions }) === loadedRef.current) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/scout/scans/${scanId}/report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ suggestionsText, polishedSuggestions }),
        });
        setSaveState(res.ok ? "saved" : "error");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setSaveState("error");
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [suggestionsText, polishedSuggestions, scanId]);

  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (cooldown <= 0) {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      return;
    }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown]);

  const suggestionsRef = useRef<HTMLTextAreaElement>(null);
  const polishedRef = useRef<HTMLTextAreaElement>(null);
  const acceptedRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = suggestionsRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [suggestionsText]);
  useEffect(() => {
    const el = polishedRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [polishedText]);
  useEffect(() => {
    const el = acceptedRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [polishedSuggestions]);

  const polishWithAi = useCallback(async () => {
    if (!suggestionsText.trim() || cooldown > 0) return;
    setPolishing(true);
    setPolishError(null);
    try {
      const res = await fetch(`/api/scout/scans/${scanId}/report/polish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: suggestionsText }),
      });
      const json = (await res.json()) as { polished?: string; error?: string; code?: string };
      if (!res.ok || !json.polished) {
        if (res.status === 429 || json.code === "rate_limit") {
          setCooldown(15);
          setPolishError("Too many requests — please wait 15 seconds.");
        } else {
          setPolishError(json.error ?? "Polishing failed.");
        }
        return;
      }
      setPolishedText(json.polished);
    } catch {
      setPolishError("Could not reach the server. Try again.");
    } finally {
      setPolishing(false);
    }
  }, [scanId, suggestionsText, cooldown]);

  const hasPreview = report && (report.status === "generated" || report.status === "delivered");

  return (
    <div className={hasPreview || generating ? "flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start" : "flex flex-col gap-5 max-w-lg"}>
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="m-0 text-base font-semibold">Your suggestions</h2>
          <p className="m-0 mt-1 text-sm leading-[1.6] text-slate-500">
            Write your rough thoughts — AI will polish them into a professional paragraph for the report.
          </p>
        </div>

        <div className="flex flex-col gap-[9px]">
          <SectionLabel weight={700}>Raw suggestions</SectionLabel>
          <textarea
            ref={suggestionsRef}
            className="w-full box-border min-h-[110px] resize-none overflow-hidden font-sans text-sm leading-[1.65] text-slate-900 border border-slate-300 rounded-lg p-[14px] outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green"
            value={suggestionsText}
            onChange={(e) => { setSuggestionsText(e.target.value); setPolishedText(null); }}
            aria-label="Your raw suggestions for AI to polish"
            placeholder="e.g. good location for 5-a-side turf, only 2 competitors both indoor, lots of schools nearby, opportunity for outdoor facility with parking"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-500" aria-live="polite">
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Draft saved"
                  : saveState === "error"
                    ? "The draft did not save."
                    : ""}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              disabled={polishing || !suggestionsText.trim() || cooldown > 0}
              onClick={() => void polishWithAi()}
            >
              {polishing ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Polishing…
                </>
              ) : cooldown > 0 ? `Wait ${cooldown}s` : polishedText ? "Regenerate with AI" : "Polish with AI"}
            </button>
          </div>
          {polishError ? <p className="m-0 text-xs text-red-600">{polishError}</p> : null}

          {polishedText !== null ? (
            <div className="flex flex-col gap-[6px]">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">AI-polished preview</div>
              <textarea
                ref={polishedRef}
                className="w-full box-border min-h-[110px] resize-none overflow-hidden border-l-[3px] border-[#159341] bg-slate-50 rounded-r-lg px-4 py-3 text-sm leading-[1.7] text-slate-700 font-sans outline-none focus:ring-2 focus:ring-[#159341]"
                value={polishedText}
                onChange={(e) => setPolishedText(e.target.value)}
                aria-label="Edit AI-polished text"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[#159341] bg-[#159341] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#127a36] transition-colors"
                  onClick={() => { setPolishedSuggestions(polishedText ?? ""); setPolishedText(null); }}
                >
                  Use this version
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                  onClick={() => setPolishedText(null)}
                >
                  Discard
                </button>
              </div>
            </div>
          ) : null}

          {polishedSuggestions && polishedText === null ? (
            <div className="flex flex-col gap-[6px]">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-[#159341] uppercase tracking-wide">Accepted AI version (used in report)</div>
                <button
                  type="button"
                  className="text-xs text-red-500 hover:text-red-700 font-semibold transition-colors"
                  onClick={() => setPolishedSuggestions("")}
                >
                  Remove
                </button>
              </div>
              <textarea
                ref={acceptedRef}
                className="w-full box-border min-h-[80px] resize-none overflow-hidden border-l-[3px] border-[#159341] bg-[#f0fdf4] rounded-r-lg px-4 py-3 text-sm leading-[1.7] text-slate-700 font-sans outline-none focus:ring-2 focus:ring-[#159341]"
                value={polishedSuggestions}
                onChange={(e) => setPolishedSuggestions(e.target.value)}
                aria-label="Edit accepted AI-polished text"
              />
              <p className="m-0 text-xs text-slate-400">This version will appear in the report. Edit your raw text above and re-polish to generate a new version.</p>
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-court-500 bg-court-500 px-4 py-2.5 text-sm font-semibold text-white hover:brightness-[0.92] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                disabled={generating}
                onClick={() => onRegenerateWithSuggestions(suggestionsText, polishedSuggestions)}
              >
                {generating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Regenerating report…
                  </>
                ) : "Use this version in report"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 mt-2">
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button className="flex-1" onClick={() => onNext(suggestionsText, polishedSuggestions)}>
            Next: Report
          </Button>
        </div>
      </div>

      {(hasPreview || generating) ? (
        <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-100 lg:sticky lg:top-4 h-[480px] lg:h-[calc(100vh-8rem)]">
          {hasPreview && report ? (
            <iframe
              key={`${report.id}-${report.version}`}
              src={`/api/scout/reports/${report.id}/pdf#navpanes=0&view=FitH`}
              className="w-full h-full border-0"
              title="Report preview"
            />
          ) : generating ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-400">
              <svg className="animate-spin h-8 w-8" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              <span className="text-sm">Generating report preview…</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
