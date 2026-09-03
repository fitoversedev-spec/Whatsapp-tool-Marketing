import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getScoutIdentity } from "@/lib/scout/identity";
import {
  dashboardSummary,
  listDashboardScans,
  listRecentReports,
} from "@/lib/scout/scans/queries";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = { title: "Saved scans — Site Scout" };
export const dynamic = "force-dynamic";

/**
 * D1 — the dashboard.
 *
 * A server component so the first paint carries real rows: the grid is the
 * whole screen, and a client-side fetch would show three empty columns for a
 * round trip. The three queries run concurrently.
 */
export default async function Page() {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");

  const [scans, reports, summary] = await Promise.all([
    listDashboardScans(identity),
    listRecentReports(identity),
    dashboardSummary(identity),
  ]);

  return <DashboardClient scans={scans} reports={reports} summary={summary} />;
}
