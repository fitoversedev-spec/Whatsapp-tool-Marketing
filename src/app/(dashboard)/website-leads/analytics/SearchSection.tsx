"use client";

import type { RangeChoice } from "./helpers";
import { fmtDay, fmtNum, fmtRate, fmtUpdated, shortUrl } from "./helpers";
import { useAnalyticsSection } from "./useAnalyticsSection";
import { CellText, EmptyNote, SectionBody, SectionCard, SimpleTable, SubHeading } from "./ui";

const COLUMNS = ["Clicks", "Shown", "Click rate", "Avg position"];

// Section 6: what people typed into Google, from Search Console. It has its own
// connection (a site address), so "not connected" only affects this card.
export default function SearchSection({ range }: { range: RangeChoice }) {
  const { state, retry } = useAnalyticsSection("search", range);
  return (
    <SectionCard
      title="Google search words"
      description="What people typed into Google before they found the website. Google's search data is about 3 days behind."
      meta={state.status === "ready" ? `Updated ${fmtUpdated(state.generatedAt)}` : undefined}
    >
      <SectionBody
        state={state}
        onRetry={retry}
        notConnected="Google Search Console is not connected yet. Once an admin connects it, the words people search for on Google will show here."
      >
        {({ data }) => {
          if (data.queries.length === 0 && data.pages.length === 0) {
            return (
              <EmptyNote>
                No Google search data for these dates yet. Google runs a few days behind, so the most recent days can
                be empty.
              </EmptyNote>
            );
          }
          return (
            <div className="space-y-5">
              {data.to !== data.requestedTo && (
                <p className="text-xs text-slate-500">
                  Showing {fmtDay(data.from)} – {fmtDay(data.to)}, the latest days Google has shared.
                </p>
              )}
              <div>
                <SubHeading>Search words</SubHeading>
                <SimpleTable
                  columns={["Search words", ...COLUMNS]}
                  minWidth={520}
                  rows={data.queries.map((q) => [
                    <CellText key="q">{q.query}</CellText>,
                    fmtNum(q.clicks),
                    fmtNum(q.impressions),
                    fmtRate(q.ctr),
                    q.position.toFixed(1),
                  ])}
                />
              </div>
              {data.pages.length > 0 && (
                <div>
                  <SubHeading>Top pages in Google</SubHeading>
                  <SimpleTable
                    columns={["Page", ...COLUMNS]}
                    minWidth={520}
                    rows={data.pages.map((p) => [
                      <CellText key="p" title={p.page}>
                        {shortUrl(p.page)}
                      </CellText>,
                      fmtNum(p.clicks),
                      fmtNum(p.impressions),
                      fmtRate(p.ctr),
                      p.position.toFixed(1),
                    ])}
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
