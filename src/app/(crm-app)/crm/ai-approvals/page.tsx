import { requireApprover } from "@/lib/agent/approverAuth";
import { listApprovalCards } from "@/lib/agent/approvalView";
import AiApprovalsClient from "./AiApprovalsClient";

export const dynamic = "force-dynamic";

// Only the people who may decide what the AI asks for (Setting agent_approvers;
// admins by default). Anyone else is sent back to the CRM home.
export default async function AiApprovalsPage() {
  await requireApprover();
  const { items, pendingCount } = await listApprovalCards("pending");
  return <AiApprovalsClient initialItems={items} initialPendingCount={pendingCount} />;
}
