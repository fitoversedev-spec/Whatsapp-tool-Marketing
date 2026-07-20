import { requireAdmin } from "@/lib/auth";
import CrmAnalyticsClient from "./CrmAnalyticsClient";

export default async function CrmAnalyticsPage() {
  await requireAdmin();
  return <CrmAnalyticsClient isAdmin={true} />;
}
