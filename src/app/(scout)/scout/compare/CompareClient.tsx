"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Button, Tag } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { formatDayMonth, formatRadius } from "@/lib/scout/display/format";
import { POPULATION_LIMITATION_TEXT } from "@/lib/scout/census/disclosure";
import type { ComparisonModel } from "@/lib/scout/compare/model";

export interface ScanOption {
  id: string;
  areaLabel: string;
  radiusM: number;
  scoreTotal: number | null;
  scoreVerdict: string | null;
  customerName: string | null;
  createdAt: string;
}

export interface CompareClientProps {
  comparison: ComparisonModel;
  options: ScanOption[];
  selectedIds: string[];
}

const MAX_COLUMNS = 4;

interface ComparisonReportRow {
  id: string;
  status: string;
  error: string | null;
  link: { url: string; expiresOnLabel: string } | null;
}

export function CompareClient({ comparison, options, selectedIds }: CompareClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [report, setReport] = useState<ComparisonReportRow | null>(null);
  const [building, setBuilding] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const buildReport = useCallback(async () => {
    setBuilding(true);
    setReportError(null);
    try {
      const ids = comparison.subjects.map((s) => s.scanId);
      const res = await fetch("/api/scout/compare/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanIds: ids }),
      });
      const json = (await res.json()) as { report?: ComparisonReportRow; error?: string };
      if (!res.ok || !json.report) {
        setReportError(json.error ?? "The comparison report could not be started.");
        return;
      }
      setReport(json.report);

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(`/api/scout/compare/report?ids=${ids.join(",")}`);
        if (!poll.ok) continue;
        const state = (await poll.json()) as { report?: ComparisonReportRow | null };
        if (!state.report) continue;
        setReport(state.report);
        if (state.report.status !== "generating") {
          if (state.report.status === "failed") setReportError(state.report.error);
          break;
        }
      }
    } catch {
      setReportError("The comparison report request failed.");
    } finally {
      setBuilding(false);
    }
  }, [comparison.subjects]);

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id].slice(-MAX_COLUMNS);
    startTransition(() => {
      router.push(next.length > 0 ? `/scout/compare?ids=${next.join(",")}` : "/scout/compare");
    });
  }

  const columns = comparison.subjects.length;
  const gridTemplate = `1.4fr repeat(${Math.max(columns, 1)}, 1fr)`;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 ssIn">
      <div className="mb-[22px]">
        <div className="mb-4">
          <h1 className="m-0 text-xl">Compare areas</h1>
          <div className="text-sm text-slate-500 mt-2 font-sans tracking-normal normal-case">
            {columns === 0
              ? "Pick two or three saved scans to compare side by side."
              : `${columns} scan${columns === 1 ? "" : "s"} selected. Best value in each row is highlighted.`}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {options.map((option) => {
            const selected = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggle(option.id)}
                disabled={pending}
                className={`text-left rounded-xl border-2 p-3 transition cursor-pointer ${
                  selected
                    ? "border-court-500 bg-court-50 ring-1 ring-court-500/30"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                }`}
              >
                <span className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    {option.areaLabel}
                  </span>
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-none transition ${
                    selected ? "border-court-500 bg-court-500" : "border-slate-300"
                  }`}>
                    {selected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                </span>
                <span className="text-xs text-slate-500 block">
                  {formatRadius(option.radiusM)}
                  {option.customerName ? ` · ${option.customerName}` : ""}
                </span>
                <span className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                  <span className="text-xs text-slate-400">
                    {formatDayMonth(option.createdAt)}
                  </span>
                  {option.scoreTotal !== null && (
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      option.scoreVerdict === "proceed" ? "bg-green-100 text-green-700"
                        : option.scoreVerdict === "avoid" ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {Math.round(option.scoreTotal)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {options.length === 0 ? (
        <StateBlock
          eyebrow="Nothing to compare"
          title="No completed scans yet"
          body="A comparison needs at least two scans that have finished running. Run one and come back."
          action={
            <Link href="/scout/scan">
              <Button>New scan</Button>
            </Link>
          }
        />
      ) : columns === 0 ? (
        <StateBlock
          eyebrow="Pick some areas"
          title="Choose two or three scans"
          body="Use the chips above. The comparison writes itself into the address bar, so you can send the exact view to somebody else."
        />
      ) : (
        <>
          {comparison.warnings.length > 0 ? (
            <div className="flex flex-col gap-[10px] mb-[22px]">
              {comparison.warnings.map((warning) => (
                <div
                  key={warning.code}
                  role={warning.severity === "warning" ? "alert" : "note"}
                  className={`rounded-lg px-[15px] py-3 text-sm leading-[1.65] ${
                    warning.severity === "warning"
                      ? "border border-amber-500 bg-white text-slate-700"
                      : "border border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {warning.message}
                </div>
              ))}
            </div>
          ) : null}

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <div className="grid min-w-[720px]" style={{ gridTemplateColumns: gridTemplate }}>
                <div className="bg-slate-900 text-white/50 px-5 py-4 text-xs font-semibold uppercase">
                  Category
                </div>
                {comparison.subjects.map((subject) => (
                  <div key={subject.scanId} className="bg-slate-900 text-white px-5 py-4 font-heading text-xs tracking-wider uppercase">
                    {subject.areaLabel}
                    <span className="block font-sans text-xs tracking-normal normal-case text-white/40 mt-1">
                      {formatRadius(subject.radiusM)}
                    </span>
                  </div>
                ))}

                {comparison.rows.map((row, index) => (
                  <div key={row.id} style={{ display: "contents" }}>
                    <div
                      className={`px-5 py-[15px] text-sm font-semibold border-t border-slate-200 ${
                        index % 2 === 1 ? "bg-[#fbfbfc]" : ""
                      }`}
                    >
                      {row.label}
                      {row.note ? (
                        <span className="block text-xs font-normal text-slate-500 leading-[1.55] mt-1">
                          {row.note}
                        </span>
                      ) : null}
                    </div>
                    {row.values.map((value, columnIndex) => (
                      <div
                        key={`${row.id}-${columnIndex}`}
                        className={`px-5 py-[15px] text-sm text-slate-700 border-t border-slate-200 ${
                          index % 2 === 1 ? "bg-[#fbfbfc]" : ""
                        } ${row.bestIndex === columnIndex ? "font-bold !text-blue-700 !bg-blue-100" : ""}`}
                      >
                        {value.display}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-4 mt-[22px] items-start flex-wrap">
            <div className="flex-1 min-w-[320px] bg-white border border-slate-200 rounded-2xl px-5 py-[18px]">
              <SectionLabel weight={700}>Read</SectionLabel>
              <div className="text-sm leading-[1.7] text-slate-700 mt-[10px] flex flex-col gap-[10px] [&>p]:m-0">
                {comparison.narrative.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <p className="text-xs leading-[1.65] text-slate-500 mt-[14px] border-t border-slate-200 pt-[11px]">
                {POPULATION_LIMITATION_TEXT}
              </p>
            </div>
            {comparison.subjects.length >= 2 ? (
              <div className="flex flex-col gap-[10px] min-w-[220px] max-w-[300px]">
                <Button onClick={() => void buildReport()} disabled={building}>
                  {building ? "Producing the comparison…" : "Build comparison report"}
                </Button>
                {report?.link ? (
                  <a
                    className="text-xs leading-[1.65] text-slate-500 break-words"
                    href={report.link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the comparison PDF — the link works until{" "}
                    {report.link.expiresOnLabel}
                  </a>
                ) : null}
                {reportError ? (
                  <p className="text-xs leading-[1.65] text-slate-500 break-words">
                    {reportError}
                  </p>
                ) : null}
              </div>
            ) : comparison.subjects[0] ? (
              <Link href={`/scout/report/${comparison.subjects[0].scanId}`}>
                <Button>Open the single-scan report</Button>
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
