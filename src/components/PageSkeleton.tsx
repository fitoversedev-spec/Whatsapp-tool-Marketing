// Instant placeholder for the route-level loading.tsx files: shown the moment a
// link is clicked while the page's data loads (before, nothing changed on
// screen for ~0.4–2 s). Plain markup — no client JS — and drawn with the slate
// ramp, so dark mode follows automatically.

export default function PageSkeleton({ variant = "list" }: { variant?: "list" | "detail" }) {
  return (
    <div className="p-4 md:p-6 space-y-4 animate-pulse" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="flex items-center justify-between gap-3">
        <div className="h-7 w-48 max-w-[60%] rounded-lg bg-slate-200" />
        <div className="h-9 w-28 rounded-lg bg-slate-200" />
      </div>
      {variant === "detail" ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="card p-4 space-y-3 md:col-span-2">
            {[92, 80, 86, 70, 76, 60].map((w, i) => (
              <div key={i} className="h-4 rounded bg-slate-200" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="card p-4 space-y-3">
            {[70, 90, 60, 80].map((w, i) => (
              <div key={i} className="h-4 rounded bg-slate-200" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="h-9 flex-1 max-w-sm rounded-lg bg-slate-200" />
            <div className="h-9 w-24 rounded-lg bg-slate-200" />
          </div>
          <div className="card divide-y divide-slate-200">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <div className="h-8 w-8 rounded-full bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 rounded bg-slate-200" />
                  <div className="h-3 w-1/2 rounded bg-slate-200" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
