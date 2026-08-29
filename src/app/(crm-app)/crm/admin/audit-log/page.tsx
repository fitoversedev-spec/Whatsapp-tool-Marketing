import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isManagementOrAbove } from "@/lib/rbac";
import AuditLogClient from "@/app/(dashboard)/admin/audit-log/AuditLogClient";

export default async function CrmAuditLogPage() {
  const user = await requireUser();
  if (!isManagementOrAbove(user.role)) {
    redirect("/crm");
  }
  return <AuditLogClient />;
}
