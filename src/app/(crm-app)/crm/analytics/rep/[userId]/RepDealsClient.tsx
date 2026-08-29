"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { downloadXlsx } from "@/lib/analytics/export";
import { StageVelocityCard, type StageVelocityRow } from "../../CrmAnalyticsClient";
import type { RepDealRow } from "@/lib/analytics/repDeals";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function RepDealsClient({
  repName,
  deals: allDeals,
  stageVelocity,
  dateRange,
}: {
  repName: string;
  deals: RepDealRow[];
  stageVelocity: StageVelocityRow[];
  dateRange: DateRange;
}) {
  const router = useRouter();
  const params = useParams();
  const [wonOnly, setWonOnly] = useState(false);
  const deals = wonOnly ? allDeals.filter((d) => d.outcome === "WON") : allDeals;

  function applyDateRange(range: DateRange) {
    router.push(`/crm/analytics/rep/${params.userId}?from=${range.from}&to=${range.to}`);
  }

  // Blank range => all-time (no pre-applied dates); only show the created-in
  // window phrasing once an actual range is picked, since new Date("") is an
  // Invalid Date and would throw in fmtDate.
  const rangeLabel =
    dateRange.from && dateRange.to
      ? ` — created ${fmtDate(new Date(dateRange.from).toISOString())} to ${fmtDate(new Date(dateRange.to).toISOString())}`
      : " — all time";

  function exportXlsx() {
    const headers = ["Customer", "Deal code", "Quotations", "Court designs", "Products interested", "Stage", "Latest note", "Next activity"];
    const rows = deals.map((d) => [
      d.customerName,
      d.dealCode,
      d.quotations.map((q) => `${q.sport} quote (${q.status})`).join(", "),
      d.courtImages.map((c) => c.number).join(", "),
      d.interestedProducts.join(", "),
      d.stageName,
      d.latestNote ? `${d.latestNote.subject}${d.latestNote.notes ? ` — ${d.latestNote.notes}` : ""} (${fmtDate(d.latestNote.occurredAt)})` : "",
      d.nextActivity ? `${d.nextActivity.message} (due ${fmtDate(d.nextActivity.dueAt)})` : "",
    ]);
    downloadXlsx(`${repName.replace(/\s+/g, "-").toLowerCase()}-deals`, headers, rows);
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        large
        title={repName}
        description={`${deals.length} customer${deals.length === 1 ? "" : "s"} being handled${wonOnly ? " (won only)" : ""}${rangeLabel}`}
        action={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <DateRangePicker value={dateRange} onApply={applyDateRange} />
            <label className="flex items-center gap-1.5 text-sm text-slate-700 border border-slate-300 rounded px-3 py-1.5 cursor-pointer">
              <input type="checkbox" checked={wonOnly} onChange={(e) => setWonOnly(e.target.checked)} className="rounded border-slate-300 text-court-600 focus:ring-court-500" />
              Won only
            </label>
            <button onClick={exportXlsx} className="btn btn-primary !px-4 !py-2 !text-sm">
              Export xlsx
            </button>
          </div>
        }
      />

      <StageVelocityCard rows={stageVelocity} />

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Quote / design / product</th>
              <th>Stage</th>
              <th>Notes / upcoming</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.dealId} className="align-top">
                <td>
                  <Link href={`/deals/${d.dealId}`} className="text-base font-semibold text-court-700 hover:underline">
                    {d.customerName}
                  </Link>
                  <div className="text-xs text-slate-500 mt-0.5 font-mono">{d.dealCode}</div>
                </td>
                <td className="text-sm space-y-1.5">
                  {d.quotations.length === 0 && d.courtImages.length === 0 && d.interestedProducts.length === 0 && (
                    <span className="text-slate-300">—</span>
                  )}
                  {/* No quote NUMBER in CRM areas (per spec) — customer is
                      already its own column, so the label is sport + status. */}
                  {d.quotations.map((q) => (
                    <div key={q.id}>
                      <a href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer" className="text-court-700 hover:underline font-medium">
                        📄 {q.sport} quote · {q.status}
                      </a>
                    </div>
                  ))}
                  {d.courtImages.map((c) => (
                    <div key={c.id}>
                      {c.imageUrl ? (
                        <a href={c.imageUrl} target="_blank" rel="noreferrer" className="text-court-700 hover:underline font-medium">
                          🎨 Design {c.number}
                        </a>
                      ) : (
                        <span className="text-slate-500 font-medium">🎨 Design {c.number}</span>
                      )}
                      <span className="text-slate-400"> ({c.status})</span>
                    </div>
                  ))}
                  {d.interestedProducts.length > 0 && (
                    <div className="text-slate-600">📦 {d.interestedProducts.join(", ")}</div>
                  )}
                </td>
                <td>
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={{ background: (d.stageColorHex ?? "#64748b") + "20", color: d.stageColorHex ?? "#475569" }}
                  >
                    {d.stageName}
                  </span>
                </td>
                {/* max-w-sm (not the old max-w-xs) + no `truncate` on the note
                    body below — the note text used to be forced onto one
                    line and cut off with an ellipsis, hiding everything
                    past it (see the screenshot this fixed). It now wraps
                    in full. */}
                <td className="text-sm text-slate-600 space-y-1.5 max-w-sm">
                  {d.latestNote ? (
                    <div>
                      <span className="font-semibold text-slate-900">{d.latestNote.subject}</span>
                      {d.latestNote.notes && <div className="text-slate-600 mt-0.5">{d.latestNote.notes}</div>}
                      <div className="text-xs text-slate-400 mt-0.5 font-mono">{fmtDate(d.latestNote.occurredAt)}</div>
                    </div>
                  ) : (
                    <div className="text-slate-300">No notes yet</div>
                  )}
                  {d.nextActivity && (
                    <div className="text-amber-700 font-medium">
                      Next: {d.nextActivity.message} — {fmtDate(d.nextActivity.dueAt)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {deals.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-400">
                  {wonOnly ? "No won deals for this rep in this range." : "No deals for this rep in this range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
