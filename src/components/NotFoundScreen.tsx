import Link from "next/link";

// What not-found.tsx shows for a deleted record or a wrong link, instead of
// Next's bare 404.
export default function NotFoundScreen({
  homeHref = "/inbox",
  homeLabel = "Go to Inbox",
}: {
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <div className="p-6 sm:p-10 max-w-2xl mx-auto">
      <div className="card p-8 shadow-sm">
        <div className="text-3xl mb-3">🔍</div>
        <h1 className="text-lg font-semibold text-slate-900 mb-1">We couldn&apos;t find that page.</h1>
        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
          It may have been deleted, or the link is old or mistyped.
        </p>
        <Link href={homeHref} className="btn btn-primary">
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
