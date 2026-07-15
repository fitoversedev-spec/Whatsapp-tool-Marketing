import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isManagementOrAbove } from "@/lib/rbac";
import AuditLogClient from "./AuditLogClient";

export default async function AuditLogPage() {
  const user = await requireUser();
  if (!isManagementOrAbove(user.role)) {
    redirect("/inbox");
  }
  return <AuditLogClient />;
}
