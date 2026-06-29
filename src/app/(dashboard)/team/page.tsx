// Admin-only sales team performance dashboard. Shows team KPI rollup +
// per-salesperson metrics + recent activity feed. Strictly guards on
// role here (in addition to the API) so a sales user typing the URL
// gets a clean redirect instead of empty data.

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import TeamAnalyticsClient from "./TeamAnalyticsClient";

export default async function TeamPage() {
  const user = await requireUser();
  if (user.role !== "admin") {
    redirect("/inbox");
  }
  return <TeamAnalyticsClient />;
}
