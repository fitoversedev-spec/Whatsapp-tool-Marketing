"use client";

import type { ReactNode } from "react";
import type { OverviewData, ResolvedRange } from "@/lib/website-analytics/types";
import type { SectionState } from "./useAnalyticsSection";
import { fmtDay, fmtNum, fmtRate, fmtSecs, fmtUpdated } from "./helpers";
import { Delta, SectionBody, SectionCard, SubHeading } from "./ui";
import TrendChart from "./TrendChart";

function Tile({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`bg-slate-50 rounded-lg p-3 sm:p-4 ${className}`}>
      <div className="text-sm text-slate-600">{label}</div>
      {children}
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

// A number with its % change against the previous period.
function Figure({ value, current, previous }: { value: string; current: number | null; previous: number | null }) {
  return (
    <>
      <div className="text-xl font-semibold mt-1 font-mono text-slate-900">{value}</div>
      <div className="mt-1">
        <Delta value={current} previous={previous} />
      </div>
    </>
  );
}

function OverviewTiles({ data }: { data: OverviewData }) {
  const { leads } = data;
  const splitTotal = data.newVisitors.value + data.returningVisitors.value;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile label="Visitors">
        <Figure value={fmtNum(data.visitors.value)} current={data.visitors.value} previous={data.visitors.previous} />
      </Tile>
      <Tile label="Visits">
        <Figure value={fmtNum(data.visits.value)} current={data.visits.value} previous={data.visits.previous} />
      </Tile>
      <Tile label="Page views">
        <Figure value={fmtNum(data.pageViews.value)} current={data.pageViews.value} previous={data.pageViews.previous} />
      </Tile>
      <Tile label="Form leads">
        <Figure value={fmtNum(leads.total)} current={leads.total} previous={leads.previous} />
      </Tile>
      <Tile label="Lead rate" hint="Form leads ÷ visitors">
        <Figure value={fmtRate(leads.rate)} current={leads.rate} previous={leads.previousRate} />
      </Tile>
      <Tile label="Avg time per visitor">
        <Figure
          value={fmtSecs(data.avgEngagementSec.value)}
          current={data.avgEngagementSec.value}
          previous={data.avgEngagementSec.previous}
        />
      </Tile>
      <Tile label="New vs returning" className="col-span-2">
        <div className="mt-1 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xl font-semibold font-mono text-slate-900">
              {fmtNum(data.newVisitors.value)} <span className="text-sm font-normal text-slate-600">new</span>
            </span>
            <Delta value={data.newVisitors.value} previous={data.newVisitors.previous} />
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xl font-semibold font-mono text-slate-900">
              {fmtNum(data.returningVisitors.value)}{" "}
              <span className="text-sm font-normal text-slate-600">returning</span>
            </span>
            <Delta value={data.returningVisitors.value} previous={data.returningVisitors.previous} />
          </div>
        </div>
        {splitTotal > 0 && (
          <div className="flex h-1.5 rounded-full overflow-hidden mt-2 bg-slate-200" aria-hidden>
            <div style={{ width: `${(data.newVisitors.value / splitTotal) * 100}%`, background: "#00AEEF" }} />
            <div style={{ width: `${(data.returningVisitors.value / splitTotal) * 100}%`, background: "#159341" }} />
          </div>
        )}
      </Tile>
    </div>
  );
}

function describeRange(range: ResolvedRange | null): string | undefined {
  if (!range) return undefined;
  return `${fmtDay(range.from)} – ${fmtDay(range.to)} (previous period: ${fmtDay(range.prevFrom)} – ${fmtDay(range.prevTo)})`;
}

// Section 1: the headline tiles and the daily chart. Its state is owned by the
// Analytics tab, which also uses it to tell whether Google is connected at all.
export default function OverviewSection({
  state,
  onRetry,
}: {
  state: SectionState<"overview">;
  onRetry: () => void;
}) {
  return (
    <SectionCard
      title="Overview"
      description={state.status === "ready" ? describeRange(state.range) : undefined}
      meta={state.status === "ready" ? `Updated ${fmtUpdated(state.generatedAt)}` : undefined}
    >
      <SectionBody state={state} onRetry={onRetry} skeleton="tiles">
        {({ data }) => (
          <div className="space-y-5">
            <OverviewTiles data={data} />
            <div>
              <SubHeading>Visitors and form leads per day</SubHeading>
              <TrendChart
                data={data.series}
                series={[
                  { key: "visitors", label: "Visitors", color: "#00AEEF" },
                  { key: "leads", label: "Form leads", color: "#159341", axis: "right" },
                ]}
              />
            </div>
          </div>
        )}
      </SectionBody>
    </SectionCard>
  );
}
