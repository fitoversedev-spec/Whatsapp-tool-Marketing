"use client";

import type { RangeChoice } from "./helpers";
import { fmtNum, fmtUpdated, GROUP_COLORS } from "./helpers";
import { useAnalyticsSection } from "./useAnalyticsSection";
import { BarList, CellText, EmptyNote, SectionBody, SectionCard, SimpleTable, SubHeading } from "./ui";
import TrendChart from "./TrendChart";

const AI_COLOR = GROUP_COLORS["AI assistants"];

// Section 4: visits that came from ChatGPT, Gemini, Perplexity and the other AI assistants.
export default function AiSection({ range }: { range: RangeChoice }) {
  const { state, retry } = useAnalyticsSection("ai", range);
  return (
    <SectionCard
      title="AI assistant visitors"
      description="People who clicked through to the website from ChatGPT, Gemini, Perplexity and other AI assistants"
      meta={state.status === "ready" ? `Updated ${fmtUpdated(state.generatedAt)}` : undefined}
    >
      <SectionBody state={state} onRetry={retry}>
        {({ data }) => {
          if (data.totalSessions === 0 || data.assistants.length === 0) {
            return (
              <EmptyNote>
                No visits from AI assistants in this period yet. When someone clicks a link to the website inside
                ChatGPT, Gemini or a similar assistant, they will show up here.
              </EmptyNote>
            );
          }
          return (
            <div className="space-y-5">
              <div>
                <SubHeading>{`${fmtNum(data.totalSessions)} ${data.totalSessions === 1 ? "visit" : "visits"} from AI assistants`}</SubHeading>
                <BarList
                  items={data.assistants.map((a) => ({
                    label: a.label,
                    value: a.sessions,
                    color: AI_COLOR,
                    note: `${fmtNum(a.visitors)} ${a.visitors === 1 ? "visitor" : "visitors"}`,
                  }))}
                />
              </div>
              <div>
                <SubHeading>Visits per day</SubHeading>
                <TrendChart
                  height={160}
                  data={data.trend}
                  series={[{ key: "sessions", label: "Visits", color: AI_COLOR }]}
                />
              </div>
              {data.landingPages.length > 0 && (
                <div>
                  <SubHeading>Pages they land on</SubHeading>
                  <SimpleTable
                    columns={["Page", "Visits"]}
                    rows={data.landingPages.map((p) => [<CellText key="p">{p.page}</CellText>, fmtNum(p.sessions)])}
                  />
                </div>
              )}
            </div>
          );
        }}
      </SectionBody>
    </SectionCard>
  );
}
