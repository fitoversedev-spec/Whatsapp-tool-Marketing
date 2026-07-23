"use client";

import Link from "next/link";

// The wrapping card every analytics view uses — structurally enforces the
// build's governance rule that no component ships without a recommended
// action + a drill-to-deals link. Callers are expected to supply at least
// one of `action`/`drillHref`; omit both only for genuinely non-data
// screens (e.g. a pure settings/admin card), never for a data card.
export function AnalyticsCard({
  title,
  description,
  children,
  action,
  drillHref,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: string;
  drillHref?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && <p className="text-sm text-slate-600 mt-1 mb-3">{description}</p>}
      <div className={description ? "" : "mt-3"}>{children}</div>
      {(action || drillHref) && (
        <div className="border-t border-slate-100 pt-2 mt-3 flex items-center justify-between gap-3 text-sm">
          {action && <span className="text-slate-600">{action}</span>}
          {drillHref && (
            <Link href={drillHref} className="text-wa-dark hover:underline font-medium whitespace-nowrap">
              See the deals →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
