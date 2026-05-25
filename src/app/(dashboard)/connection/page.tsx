import { requireAdmin } from "@/lib/auth";
import { getConnectionStatus } from "@/lib/meta-connection";
import ConnectionClient from "./ConnectionClient";

export default async function ConnectionPage() {
  await requireAdmin();
  const status = await getConnectionStatus();
  return <ConnectionClient status={status} />;
}
