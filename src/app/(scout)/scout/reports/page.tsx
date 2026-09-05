import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { ScreenScaffold, StateBlock } from "@/components/scout/patterns";
import { getScoutIdentity, canAccessAllScans } from "@/lib/scout/identity";
import { listAllReports } from "@/lib/scout/reports/repository";

import { ReportListClient } from "./ReportListClient";

export const metadata: Metadata = { title: "Reports — Site Scout" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");

  const reports = await listAllReports(
    canAccessAllScans(identity) ? undefined : identity.userId,
  );

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref="/scout/dashboard" />
      </div>
      <ScreenScaffold
        eyebrow="Reports"
        title="All Reports"
        lede={`${reports.length} report${reports.length === 1 ? "" : "s"} generated so far.`}
      >
        {reports.length === 0 ? (
          <StateBlock
            eyebrow="No reports yet"
            title="No reports generated"
            body="Generate a report from any scan to see it here. Open a scan and click Create report."
            action={
              <Link href="/scout/dashboard">
                <button className="inline-flex items-center gap-2 rounded-lg bg-court-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-court-600 transition-colors">
                  Go to Dashboard
                </button>
              </Link>
            }
          />
        ) : (
          <ReportListClient reports={reports} />
        )}
      </ScreenScaffold>
    </>
  );
}
