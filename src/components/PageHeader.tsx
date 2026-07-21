import BackButton from "./BackButton";

// hideBack: for the true "home" tab (Inbox) where back would leave the
// app entirely on mobile PWA. Every other page shows it — even sidebar
// destinations, because on mobile the sidebar is a drawer and back is
// often faster than reopening it.
export default function PageHeader({
  title,
  description,
  action,
  backHref,
  hideBack,
  large,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  backHref?: string;
  hideBack?: boolean;
  // Opt-in bigger/darker title+description — used by the CRM section only
  // (per explicit request); every other caller is unaffected by default.
  large?: boolean;
}) {
  return (
    <header className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 border-b border-slate-200 bg-white">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          {!hideBack && (
            <div className="mb-1.5">
              <BackButton backHref={backHref} />
            </div>
          )}
          <h1 className={large ? "text-2xl sm:text-3xl font-bold text-slate-900" : "text-xl sm:text-2xl font-bold text-slate-900"}>{title}</h1>
          {description && (
            <p className={large ? "text-base text-slate-600 mt-1 leading-snug" : "text-sm text-slate-500 mt-1 leading-snug"}>{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
