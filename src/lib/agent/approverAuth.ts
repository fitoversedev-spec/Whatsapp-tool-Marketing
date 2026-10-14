import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isApprover } from "./approvals";

/**
 * Human-side gate for the AI approvals screens and API: a signed-in person (the
 * normal cookie session) who is on the approvers list. The AI's service account
 * can never pass: getCurrentUser() returns null for it, and isApprover() refuses
 * its role again. An AI key is never accepted here.
 */
export type ApproverUser = { id: string; role: string; name: string };

export async function getApproverOrStatus(): Promise<{ user: ApproverUser } | { status: 401 | 403 }> {
  const user = await getCurrentUser();
  if (!user) return { status: 401 };
  if (!(await isApprover(user))) return { status: 403 };
  return { user: { id: user.id, role: user.role, name: user.name } };
}

/** For server pages: not signed in -> /login; signed in but not an approver -> /crm. */
export async function requireApprover(): Promise<ApproverUser> {
  const r = await getApproverOrStatus();
  if ("status" in r) redirect(r.status === 401 ? "/login" : "/crm");
  return r.user;
}
