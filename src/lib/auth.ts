import { redirect } from "next/navigation";
import { getSession } from "./session";
import { prisma } from "./prisma";

export async function getCurrentUser() {
  const session = await getSession();
  if (!session.userId) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  // Block deleted / inactive / non-approved users from any access
  if (!user) return null;
  if (user.deletedAt) return null;
  if (!user.isActive) return null;
  if (user.approvalStatus !== "approved") return null;
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/inbox");
  return user;
}

// Analytics is open to every approved role — access, not scope. Which
// deals a role actually sees is decided downstream, once, by
// src/lib/analytics/scope.ts.
export async function requireAnalyticsAccess() {
  return requireUser();
}
