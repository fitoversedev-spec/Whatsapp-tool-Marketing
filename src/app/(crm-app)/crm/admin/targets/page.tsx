import { requireAdmin } from "@/lib/auth";
import TargetsAdminClient from "@/app/(dashboard)/admin/targets/TargetsAdminClient";

export default async function CrmTargetsAdminPage() {
  await requireAdmin();
  return <TargetsAdminClient />;
}
