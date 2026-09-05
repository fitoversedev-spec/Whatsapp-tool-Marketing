import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/scout/ui";
import { ScreenScaffold, StateBlock } from "@/components/scout/patterns";
import { ScoreBadge } from "@/components/scout/score";
import { getScoutIdentity } from "@/lib/scout/identity";
import { listDashboardScans } from "@/lib/scout/scans/queries";
import { atLeast, formatDayMonth, formatRadius } from "@/lib/scout/display/format";
import { ArchiveScanButton } from "./ArchiveScanButton";

export const metadata: Metadata = { title: "Saved Scans — Site Scout" };
export const dynamic = "force-dynamic";

/**
 * "My sites" — the saved-scan list in row form.
 *
 * The desktop counterpart of mobile screen 05. It is the same data as the
 * dashboard grid, arranged for scanning down rather than across: one row per
 * area with its headline stat and its score, so a salesperson looking for a
 * particular plot finds it by name rather than by picture.
 */
export default async function Page() {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");

  const scans = await listDashboardScans(identity);

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref="/scout/dashboard" />
      </div>
      <ScreenScaffold
        eyebrow="Saved Scans"
        title="Saved Scans"
        lede="Every area you have scanned, newest first."
        actions={
          <Link href="/scout/scan">
            <Button>New site check</Button>
          </Link>
        }
      >
        {scans.length === 0 ? (
          <StateBlock
            eyebrow="Nothing saved yet"
            title="No scans yet"
            body="Run a scan to see the competing facilities and demand anchors around a plot. Nothing is billed until you press Run scan, and the cost is on screen before you do."
            action={
              <Link href="/scout/scan">
                <Button>New site check</Button>
              </Link>
            }
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {scans.map((scan) => (
              <Link
                key={scan.id}
                href={`/scout/scan/${scan.id}`}
                className="group flex items-center gap-[18px] py-[15px] px-5 border-t border-slate-200 no-underline text-slate-900 font-sans first:border-t-0 hover:bg-slate-100"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold">{scan.areaLabel}</span>
                  <span className="block text-xs text-slate-500 mt-[3px]">
                    {formatRadius(scan.radiusM)} · {formatDayMonth(scan.createdAt)} ·{" "}
                    {scan.ownerName}
                    {scan.customerName ? ` · ${scan.customerName}` : ""}
                  </span>
                </span>
                <span className="flex-none text-right min-w-[90px]">
                  <span className="block font-mono text-lg font-semibold">
                    {scan.facilityCount === null
                      ? "—"
                      : atLeast(scan.facilityCount, scan.saturated)}
                  </span>
                  <span className="block text-xs text-slate-600 mt-[3px]">Facilities</span>
                </span>
                <ScoreBadge
                  total={scan.scoreTotal}
                  verdict={scan.scoreVerdict}
                  basis={scan.scoreBasis}
                  size="sm"
                />
                <ArchiveScanButton scanId={scan.id} />
              </Link>
            ))}
          </div>
        )}
      </ScreenScaffold>
    </>
  );
}
