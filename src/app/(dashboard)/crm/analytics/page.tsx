import { requireAnalyticsAccess } from "@/lib/auth";
import { isAdmin, type Role } from "@/lib/rbac";
import CrmAnalyticsClient from "./CrmAnalyticsClient";

export default async function CrmAnalyticsPage() {
  const user = await requireAnalyticsAccess();
  return <CrmAnalyticsClient isAdmin={isAdmin(user.role)} role={user.role as Role} />;
}
