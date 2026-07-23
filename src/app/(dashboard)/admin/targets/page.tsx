import { requireAdmin } from "@/lib/auth";
import TargetsAdminClient from "./TargetsAdminClient";

export default async function TargetsAdminPage() {
  await requireAdmin();
  return <TargetsAdminClient />;
}
