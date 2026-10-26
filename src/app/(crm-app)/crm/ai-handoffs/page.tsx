import { redirect } from "next/navigation";
import { countPendingHandoffs, listAssignees, listHandoffCards } from "@/lib/agent/handoffs/admin";
import { getHandoffViewer } from "@/lib/agent/handoffs/viewer";
import AiHandoffsClient from "./AiHandoffsClient";

export const dynamic = "force-dynamic";

// Customers who asked the AI Sales Agent for a person. Approvers (Setting
// agent_approvers; admins by default) assign a salesperson; everyone else sees
// the chats assigned to them and can hand them back to the AI.
export default async function AiHandoffsPage() {
  const viewer = await getHandoffViewer();
  if (!viewer) redirect("/login");
  const initialTab = viewer.approver ? "PENDING" : "APPROVED";
  const [items, pendingCount, assignees] = await Promise.all([
    listHandoffCards(viewer, initialTab),
    viewer.approver ? countPendingHandoffs() : Promise.resolve(0),
    viewer.approver ? listAssignees() : Promise.resolve([]),
  ]);
  return (
    <AiHandoffsClient
      approver={viewer.approver}
      initialTab={initialTab}
      initialItems={items}
      initialPendingCount={pendingCount}
      assignees={assignees}
    />
  );
}
