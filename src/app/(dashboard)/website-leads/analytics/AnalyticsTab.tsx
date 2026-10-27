"use client";

import { useState } from "react";
import type { RangeChoice } from "./helpers";
import { useAnalyticsSection } from "./useAnalyticsSection";
import RangePicker from "./RangePicker";
import OverviewSection from "./OverviewSection";
import LiveSection from "./LiveSection";
import SourcesSection from "./SourcesSection";
import AiSection from "./AiSection";
import PagesSection from "./PagesSection";
import SearchSection from "./SearchSection";
import LeadsBySourceSection from "./LeadsBySourceSection";

// The Analytics tab: one date range, then the sections top to bottom. Every
// section loads on its own (own skeleton, own error + Try again). The Overview
// is also the "is Google Analytics connected?" check: when it is not, one card
// replaces the five Google Analytics sections; Search Console (its own
// connection) and Leads by source (our database) still show.
export default function AnalyticsTab() {
  const [range, setRange] = useState<RangeChoice>({ preset: "30d", from: "", to: "" });
  const overview = useAnalyticsSection("overview", range);
  const gaOff = overview.state.status === "not-connected" ? overview.state : null;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        Google counts only visitors who accept cookies, so visitor numbers are lower than reality. Form leads are
        counted exactly by this tool.
      </p>

      <RangePicker value={range} onChange={setRange} />

      {gaOff ? (
        <section className="card p-6 text-center">
          <h2 className="text-base font-semibold text-slate-900">Google Analytics is not connected yet</h2>
          <p className="text-sm text-slate-600 mt-1">
            Once an admin connects it, your visitor numbers, live visitors and where people come from will show up here.
          </p>
        </section>
      ) : (
        <>
          <OverviewSection state={overview.state} onRetry={overview.retry} />
          <LiveSection />
          <SourcesSection range={range} />
          <AiSection range={range} />
          <PagesSection range={range} />
        </>
      )}

      <SearchSection range={range} />
      <LeadsBySourceSection range={range} />
    </div>
  );
}
