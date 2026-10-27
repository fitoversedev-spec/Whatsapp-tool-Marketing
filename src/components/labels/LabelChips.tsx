import type { ReactNode } from "react";
import type { MetaLeadLabelChip } from "@/lib/meta-ads/queries";
import { labelChip, labelDot } from "@/lib/meta-ads/lead-fields";

// Small wrapping chips for the labels applied to a lead or contact (the shared
// MetaLeadLabel catalogue). With onRemove each chip gets a × button; leave it off
// for a read-only list. Renders `fallback` (default: nothing) when there are none.
export default function LabelChips({
  labels,
  onRemove,
  disabled,
  fallback = null,
  className = "",
}: {
  labels: MetaLeadLabelChip[];
  onRemove?: (id: string) => void;
  disabled?: boolean; // greys out the × buttons (e.g. while saving)
  fallback?: ReactNode;
  className?: string;
}) {
  if (labels.length === 0) return <>{fallback}</>;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {labels.map((l) => (
        <span
          key={l.id}
          className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${labelChip(l.color)}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${labelDot(l.color)}`} />
          <span className="truncate">{l.name}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(l.id)}
              disabled={disabled}
              aria-label={`Remove label ${l.name}`}
              className="ml-0.5 shrink-0 opacity-70 hover:opacity-100 disabled:opacity-40"
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
