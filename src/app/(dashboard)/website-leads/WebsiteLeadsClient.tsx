"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import type { Rep } from "@/components/meta/MoveToCrmDialog";
import type { MetaLeadStageRow } from "@/lib/meta-ads/lead-fields";
import type { WebsiteLeadPage, WebsiteLeadOptions } from "@/lib/website-leads/list";
import WebsiteLeadsTable from "./WebsiteLeadsTable";
import WebsiteLeadsTabs from "./analytics/WebsiteLeadsTabs";

// Page shell for /website-leads: header, the Leads | Analytics tabs, the
// received-date range (pushed to the URL so the server page re-fetches the first
// page) and the table.
export default function WebsiteLeadsClient({
  initial,
  reps,
  stageCatalog,
  canBulkAssign,
  canRemove,
  range,
}: {
  initial: WebsiteLeadPage & { options: WebsiteLeadOptions };
  reps: Rep[];
  stageCatalog: MetaLeadStageRow[];
  canBulkAssign: boolean;
  canRemove: boolean;
  range: DateRange;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function applyRange(next: DateRange) {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/website-leads?${qs}` : "/website-leads");
    });
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        large
        title="Fito Website"
        description="Leads and visitor analytics from fitoverse.com"
        action={<DateRangePicker value={range} onApply={applyRange} />}
      />

      <div className="mt-4">
        <WebsiteLeadsTabs active="leads" />
      </div>

      <div className={`mt-4 space-y-4 ${pending ? "opacity-60 transition-opacity" : ""}`}>
        {pending && <div className="text-xs text-slate-400">Updating…</div>}
        {/* Keyed by range: a new date range brings a new first page. */}
        <WebsiteLeadsTable
          key={`${range.from}|${range.to}`}
          initial={initial}
          range={range}
          reps={reps}
          stageCatalog={stageCatalog}
          canBulkAssign={canBulkAssign}
          canRemove={canRemove}
        />
      </div>
    </div>
  );
}
