"use client";

import type { RangeChoice } from "./helpers";
import { deviceLabel, fmtNum, fmtUpdated, GROUP_COLORS, nameOrUnknown } from "./helpers";
import { useAnalyticsSection } from "./useAnalyticsSection";
import { BarList, CellText, EmptyNote, SectionBody, SectionCard, SimpleTable, SubHeading } from "./ui";

// "google / organic" under the label; nothing for direct visits.
function sourceDetail(source: string, medium: string): string | null {
  if (!source || source === "(direct)") return null;
  return medium && medium !== "(none)" ? `${source} / ${medium}` : source;
}

// Section 3: the channels (AI assistants get their own), the top sources, the
// top cities and phone vs computer.
export default function SourcesSection({ range }: { range: RangeChoice }) {
  const { state, retry } = useAnalyticsSection("sources", range);
  return (
    <SectionCard
      title="Where visitors come from"
      description="How people found the website, counted in visits"
      meta={state.status === "ready" ? `Updated ${fmtUpdated(state.generatedAt)}` : undefined}
    >
      <SectionBody state={state} onRetry={retry}>
        {({ data }) => {
          if (data.totalSessions === 0) return <EmptyNote>No visits in this period.</EmptyNote>;
          const deviceTotal = data.devices.reduce((n, d) => n + d.visitors, 0);
          return (
            <div className="space-y-5">
              <div>
                <SubHeading>Channels</SubHeading>
                <BarList
                  total={data.totalSessions}
                  items={data.channels.map((c) => ({ label: c.group, value: c.sessions, color: GROUP_COLORS[c.group] }))}
                />
              </div>
              <div>
                <SubHeading>Top sources</SubHeading>
                <SimpleTable
                  columns={["Came from", "Type", "Visits"]}
                  minWidth={380}
                  rows={data.topSources.map((s) => {
                    const detail = sourceDetail(s.source, s.medium);
                    return [
                      <div key="n">
                        <CellText>{s.label}</CellText>
                        {detail && <span className="block text-xs text-slate-400">{detail}</span>}
                      </div>,
                      <span key="g" className="font-sans text-slate-600">
                        {s.group}
                      </span>,
                      fmtNum(s.sessions),
                    ];
                  })}
                />
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="min-w-0">
                  <SubHeading>Top cities</SubHeading>
                  {data.cities.length === 0 ? (
                    <EmptyNote>No city data yet.</EmptyNote>
                  ) : (
                    <SimpleTable
                      columns={["City", "Visitors", "Visits"]}
                      minWidth={280}
                      rows={data.cities.map((c) => [
                        <CellText key="c">{nameOrUnknown(c.city)}</CellText>,
                        fmtNum(c.visitors),
                        fmtNum(c.sessions),
                      ])}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <SubHeading>Phone or computer</SubHeading>
                  {data.devices.length === 0 ? (
                    <EmptyNote>No device data yet.</EmptyNote>
                  ) : (
                    <BarList
                      total={deviceTotal}
                      items={data.devices.map((d) => ({ label: deviceLabel(d.device), value: d.visitors, color: "#00AEEF" }))}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        }}
      </SectionBody>
    </SectionCard>
  );
}
