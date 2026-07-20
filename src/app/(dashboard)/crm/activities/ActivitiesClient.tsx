"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

type ActivityRow = {
  id: string;
  typeName: string;
  subject: string;
  notes: string | null;
  occurredAt: string;
  durationMins: number | null;
  outcome: string | null;
  ownerName: string;
  dealId: string | null;
  dealCode: string | null;
  accountId: string | null;
  accountName: string | null;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ActivitiesClient({ isAdmin, activities }: { isAdmin: boolean; activities: ActivityRow[] }) {
  const [q, setQ] = useState("");

  const visible = activities.filter(
    (a) =>
      !q.trim() ||
      a.subject.toLowerCase().includes(q.trim().toLowerCase()) ||
      a.accountName?.toLowerCase().includes(q.trim().toLowerCase()) ||
      a.dealCode?.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Activities"
        description={`${activities.length} ${isAdmin ? "team-wide" : "of yours"} — every logged touchpoint, most recent first`}
      />

      <div className="mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by subject, company, or deal code..."
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm"
        />
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          No activities found.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    <span className="text-xs font-semibold text-wa-dark bg-wa-green/10 px-1.5 py-0.5 rounded mr-1.5">{a.typeName}</span>
                    {a.subject}
                  </div>
                  {a.notes && <div className="text-xs text-slate-500 mt-1">{a.notes}</div>}
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{fmtDate(a.occurredAt)}</span>
                    <span>· {a.ownerName}</span>
                    {a.durationMins != null && <span>· {a.durationMins}m</span>}
                    {a.outcome && <span>· {a.outcome}</span>}
                    {a.dealId && (
                      <Link href={`/deals/${a.dealId}`} className="text-wa-dark hover:underline">
                        · {a.dealCode}
                      </Link>
                    )}
                    {!a.dealId && a.accountId && (
                      <Link href={`/crm/companies/${a.accountId}`} className="text-wa-dark hover:underline">
                        · {a.accountName}
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
