import { requireAdmin } from "@/lib/auth";
import { getConnectionStatus } from "@/lib/meta-connection";
import { getTokenStatus } from "@/lib/token-manager";
import ConnectionClient from "@/app/(dashboard)/connection/ConnectionClient";

export default async function CrmConnectionPage() {
  await requireAdmin();
  const [status, tokenStatus] = await Promise.all([
    getConnectionStatus(),
    getTokenStatus(),
  ]);
  return <ConnectionClient status={status} tokenStatus={tokenStatus} />;
}
