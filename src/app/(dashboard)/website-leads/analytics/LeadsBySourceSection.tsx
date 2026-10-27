"use client";

import type { RangeChoice } from "./helpers";
import { fmtNum, GROUP_COLORS } from "./helpers";
import { useAnalyticsSection } from "./useAnalyticsSection";
import { BarList, EmptyNote, SectionBody, SectionCard, SubHeading } from "./ui";

// Section 7: our own exact lead counts per "Came from" label. Straight from
// the database, so it works even when Google is not connected.
export default function LeadsBySourceSection({ range }: { range: RangeChoice }) {
  const { state, retry } = useAnalyticsSection("leadsBySource", range);
  return (
    <SectionCard
      title="Leads by source"
      description="Form leads in this period by where the visitor came from, counted exactly by this tool"
    >
      <SectionBody state={state} onRetry={retry}>
        {({ data }) => {
          if (data.total === 0) return <EmptyNote>No form leads in this period.</EmptyNote>;
          return (
            <div className="space-y-5">
              <BarList
                total={data.total}
                items={data.sources.map((s) => ({ label: s.label, value: s.count, color: GROUP_COLORS[s.group] }))}
              />
              <div>
                <SubHeading>{`${fmtNum(data.total)} ${data.total === 1 ? "lead" : "leads"} in total, by type`}</SubHeading>
                <div className="flex flex-wrap gap-1.5">
                  {data.groups.map((g) => (
                    <span key={g.group} className="chip">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: GROUP_COLORS[g.group] }} />
                      {g.group} <span className="font-mono">{fmtNum(g.count)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        }}
      </SectionBody>
    </SectionCard>
  );
}
