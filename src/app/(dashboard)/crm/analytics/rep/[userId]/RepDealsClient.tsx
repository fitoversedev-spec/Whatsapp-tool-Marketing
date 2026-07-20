"use client";

import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { downloadXlsx } from "@/lib/analytics/export";
import { StageVelocityCard, type StageVelocityRow } from "../../CrmAnalyticsClient";
import type { RepDealRow } from "@/lib/analytics/repDeals";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function RepDealsClient({
  repName,
  deals,
  stageVelocity,
}: {
  repName: string;
  deals: RepDealRow[];
  stageVelocity: StageVelocityRow[];
}) {
  function exportXlsx() {
    const headers = ["Customer", "Deal code", "Quotations", "Court designs", "Products interested", "Stage", "Latest note", "Next activity"];
    const rows = deals.map((d) => [
      d.customerName,
      d.dealCode,
      d.quotations.map((q) => q.number).join(", "),
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
        title={repName}
        description={`${deals.length} customer${deals.length === 1 ? "" : "s"} being handled`}
        action={
          <button onClick={exportXlsx} className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg">
            Export xlsx
          </button>
        }
      />

      <StageVelocityCard rows={stageVelocity} />

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Quote / design / product</th>
              <th className="px-4 py-2.5 font-medium">Stage</th>
              <th className="px-4 py-2.5 font-medium">Notes / upcoming</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.dealId} className="border-b border-slate-100 last:border-0 align-top hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/deals/${d.dealId}`} className="font-medium text-wa-dark hover:underline">
                    {d.customerName}
                  </Link>
                  <div className="text-xs text-slate-400">{d.dealCode}</div>
                </td>
                <td className="px-4 py-3 text-xs space-y-1">
                  {d.quotations.length === 0 && d.courtImages.length === 0 && d.interestedProducts.length === 0 && (
                    <span className="text-slate-300">—</span>
                  )}
                  {d.quotations.map((q) => (
                    <div key={q.id}>
                      <a href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer" className="text-wa-dark hover:underline">
                        📄 Quote {q.number}
                      </a>
                      <span className="text-slate-400"> ({q.status})</span>
                    </div>
                  ))}
                  {d.courtImages.map((c) => (
                    <div key={c.id}>
                      {c.imageUrl ? (
                        <a href={c.imageUrl} target="_blank" rel="noreferrer" className="text-wa-dark hover:underline">
                          🎨 Design {c.number}
                        </a>
                      ) : (
                        <span className="text-slate-500">🎨 Design {c.number}</span>
                      )}
                      <span className="text-slate-400"> ({c.status})</span>
                    </div>
                  ))}
                  {d.interestedProducts.length > 0 && (
                    <div className="text-slate-600">📦 {d.interestedProducts.join(", ")}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: (d.stageColorHex ?? "#64748b") + "20", color: d.stageColorHex ?? "#475569" }}
                  >
                    {d.stageName}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600 space-y-1 max-w-xs">
                  {d.latestNote ? (
                    <div>
                      <span className="font-medium text-slate-800">{d.latestNote.subject}</span>
                      {d.latestNote.notes && <div className="text-slate-500 truncate">{d.latestNote.notes}</div>}
                      <div className="text-slate-400">{fmtDate(d.latestNote.occurredAt)}</div>
                    </div>
                  ) : (
                    <div className="text-slate-300">No notes yet</div>
                  )}
                  {d.nextActivity && (
                    <div className="text-amber-700">
                      Next: {d.nextActivity.message} — {fmtDate(d.nextActivity.dueAt)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {deals.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  No deals for this rep yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
