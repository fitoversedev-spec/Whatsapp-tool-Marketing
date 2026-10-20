import { requireUser } from "@/lib/auth";
import { canSeeAllAiChats, listAiChats } from "@/lib/ai-chats/query";
import { canManageAllCustomers } from "@/lib/rbac";
import AiChatsClient from "./AiChatsClient";

export const dynamic = "force-dynamic";

// WhatsApp Marketing → AI agent chats: every chat the AI Sales Agent has
// written in, hot leads first. Admin/manager/management see all of them;
// anyone else sees the chats assigned to them plus unassigned hot ones they can take.
export default async function AiChatsPage() {
  const user = await requireUser();
  const result = await listAiChats(user);
  return (
    <AiChatsClient
      initial={result}
      seesAll={canSeeAllAiChats(user.role)}
      canLabelAll={canManageAllCustomers(user.role)}
      currentUserId={user.id}
    />
  );
}
