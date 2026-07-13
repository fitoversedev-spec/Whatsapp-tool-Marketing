"use client";

import { useEffect, useRef } from "react";

// A "select all" checkbox that shows the native indeterminate state (a dash,
// not a check) when some — but not all — of the given ids are selected.
// Shared by the court-design, quotation, and media-library list pages so
// their bulk-select UX is identical.
export default function SelectAllCheckbox({
  ids,
  selected,
  onChange,
  className,
}: {
  ids: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = ids.some((id) => selected.has(id));

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      onChange={() => onChange(allSelected ? new Set() : new Set(ids))}
      disabled={ids.length === 0}
      aria-label={allSelected ? "Deselect all" : "Select all"}
      className={className ?? "rounded"}
    />
  );
}
