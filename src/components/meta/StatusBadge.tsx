// Tiny status pill for a Meta ad campaign. ACTIVE -> emerald, PAUSED -> amber,
// anything else (ARCHIVED, DELETED, null, …) -> slate. Pure/presentational, so
// it needs no "use client" and can render on the server. Matches the
// slate/emerald/amber pill palette the Ad Campaigns area already uses.

const STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PAUSED: "bg-amber-100 text-amber-700",
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function StatusBadge({ status }: { status: string | null }) {
  const key = (status ?? "").toUpperCase();
  const cls = STYLES[key] ?? "bg-slate-100 text-slate-600";
  const label = status && status.trim() ? titleCase(status.trim()) : "Unknown";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}
