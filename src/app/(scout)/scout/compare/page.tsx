import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { getScoutIdentity } from "@/lib/scout/identity";
import { buildComparison } from "@/lib/scout/compare/model";
import { CATEGORIES } from "@/lib/scout/places/taxonomy";
import { getCompareSubjects, listComparableScans } from "@/lib/scout/scans/queries";
import { CompareClient } from "./CompareClient";

export const metadata: Metadata = { title: "Compare areas — Site Scout" };
export const dynamic = "force-dynamic";

/**
 * D4 — the comparison.
 *
 * The selection lives in `?ids=`, so a comparison is a URL: the salesperson can
 * paste the exact three columns they were looking at into a message rather than
 * describing them.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: { ids?: string };
}) {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");
  if (!identity.canRunScans) notFound();

  const { ids } = searchParams;
  const requested = (ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

  const [options, subjects] = await Promise.all([
    listComparableScans(identity),
    getCompareSubjects(identity, requested),
  ]);

  const comparison = buildComparison(
    subjects,
    CATEGORIES.map((c) => ({ id: c.id, label: c.label, side: c.side })),
  );

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref="/scout/dashboard" />
      </div>
      <CompareClient
        comparison={comparison}
        options={options.map((o) => ({
          id: o.id,
          areaLabel: o.areaLabel,
          radiusM: o.radiusM,
          scoreTotal: o.scoreTotal,
          scoreVerdict: o.scoreVerdict,
          customerName: o.customerName,
          createdAt: o.createdAt,
        }))}
        selectedIds={subjects.map((s) => s.scanId)}
      />
    </>
  );
}
