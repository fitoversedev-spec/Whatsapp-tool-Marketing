import { getCurrentUser } from "@/lib/auth";
import { isApprover } from "../approvals";
import type { HandoffViewer } from "./admin";

/**
 * The signed-in person on the AI handoffs screen and API (normal cookie
 * session; an AI key is never accepted). Approvers decide requests; anyone
 * else signed in only sees, and can hand back, the chats assigned to them.
 */
export async function getHandoffViewer(): Promise<HandoffViewer | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, name: user.name, approver: await isApprover(user) };
}
