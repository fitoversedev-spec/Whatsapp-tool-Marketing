"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireScoutIdentity } from "@/lib/scout/identity";

export interface AdminActionState {
  message?: string;
  error?: string;
}

async function requireScoringWeightsAccess() {
  const identity = await requireScoutIdentity();
  if (!identity.canEditScoringWeights) throw new Error("Not authorised.");
  return identity;
}

export async function approveUserAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireScoringWeightsAccess();
  const userId = String(formData.get("userId") ?? "");
  const roleRaw = String(formData.get("role") ?? "sales");
  const role = roleRaw === "admin" ? "admin" : "sales";

  if (!userId) return { error: "No user selected." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.approvalStatus !== "pending") {
    return { error: "That account is no longer pending." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { approvalStatus: "approved", role },
  });

  revalidatePath("/scout/admin/users");
  return { message: `Approved as ${role}. They can sign in now.` };
}

export async function rejectUserAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireScoringWeightsAccess();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "No user selected." };
  if (userId === admin.userId) return { error: "You cannot reject your own account." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "No such account." };

  await prisma.user.update({
    where: { id: userId },
    data: { approvalStatus: "rejected" },
  });

  revalidatePath("/scout/admin/users");
  return { message: "Access refused." };
}
