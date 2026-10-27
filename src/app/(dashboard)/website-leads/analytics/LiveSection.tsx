"use client";

import { deviceLabel, fmtNum, fmtUpdated } from "./helpers";
import { useAnalyticsSection } from "./useAnalyticsSection";
import { BarList, EmptyNote, SectionBody, SectionCard, SubHeading } from "./ui";

const REFRESH_MS = 60_000;

// Section 2: who is on the site right now. Re-fetches every minute while this
// browser tab is visible (see useAnalyticsSection); it ignores the date range.
export default function LiveSection() {
  const { state, retry } = useAnalyticsSection("live", null, REFRESH_MS);
  return (
    <SectionCard
      title="Live now"
      description="Visitors on the website in the last 30 minutes. Refreshes every minute."
      meta={state.status === "ready" ? `Updated ${fmtUpdated(state.generatedAt)}` : undefined}
    >
      <SectionBody state={state} onRetry={retry}>
        {({ data }) => (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="bg-slate-50 rounded-lg p-4 min-w-0">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                </span>
                Visitors right now
              </div>
              <div className="text-3xl font-semibold font-mono text-slate-900 mt-1">{fmtNum(data.activeUsers)}</div>
              <div className="text-xs text-slate-400 mt-0.5">in the last {data.windowMinutes} minutes</div>
              {data.devices.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {data.devices.map((d) => (
                    <span key={d.device} className="chip">
                      {deviceLabel(d.device)} <span className="font-mono">{fmtNum(d.users)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="sm:col-span-2 min-w-0">
              <SubHeading>Pages they are on</SubHeading>
              {data.pages.length === 0 ? (
                <EmptyNote>Nobody is on the website right now.</EmptyNote>
              ) : (
                <BarList items={data.pages.map((p) => ({ label: p.page, value: p.users, color: "#00AEEF" }))} />
              )}
            </div>
          </div>
        )}
      </SectionBody>
    </SectionCard>
  );
}
