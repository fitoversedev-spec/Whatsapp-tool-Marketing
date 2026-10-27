"use client";

import type { BuildStepKey } from "@/lib/website-analytics/types";
import type { RangeChoice } from "./helpers";
import { fmtNum, fmtSecs, fmtUpdated } from "./helpers";
import { useAnalyticsSection } from "./useAnalyticsSection";
import { BarList, CellText, EmptyNote, SectionBody, SectionCard, SimpleTable, SubHeading } from "./ui";

// Plain words for the four "Build a court" counts.
const STEP_LABELS: Record<BuildStepKey, string> = {
  viewed_build: "Visited Build a court",
  designer_step: "Used the court designer",
  generate_lead: "Sent a form (enquiry or download)",
  contact_click: "Clicked WhatsApp or call",
};

// Section 5: the most viewed pages and the Build a court steps (one request).
export default function PagesSection({ range }: { range: RangeChoice }) {
  const { state, retry } = useAnalyticsSection("pages", range);
  return (
    <SectionCard
      title="Pages"
      description="The most viewed pages on the website"
      meta={state.status === "ready" ? `Updated ${fmtUpdated(state.generatedAt)}` : undefined}
    >
      <SectionBody state={state} onRetry={retry}>
        {({ data }) => (
          <div className="space-y-6">
            {data.pages.length === 0 ? (
              <EmptyNote>No page views in this period.</EmptyNote>
            ) : (
              <SimpleTable
                columns={["Page", "Views", "Visitors", "Avg time"]}
                minWidth={420}
                rows={data.pages.map((p) => [
                  <CellText key="p">{p.path}</CellText>,
                  fmtNum(p.views),
                  fmtNum(p.visitors),
                  fmtSecs(p.avgEngagementSec),
                ])}
              />
            )}
            <div>
              <SubHeading>Build a court steps</SubHeading>
              <p className="text-xs text-slate-500 mb-3">
                Each step counts people separately, so one person can be in more than one.
              </p>
              <p className="text-xs text-slate-500 mb-3">
                “Sent a form” also counts people who left their details to download a design, so it can be higher than Form leads.
              </p>
              <BarList
                items={data.buildSteps.map((s) => ({
                  label: STEP_LABELS[s.key] ?? s.label,
                  value: s.people,
                  color: "#00AEEF",
                }))}
              />
            </div>
          </div>
        )}
      </SectionBody>
    </SectionCard>
  );
}
